const core = require("@actions/core");
const github = require("@actions/github");
const glob = require("@actions/glob");
const parser = require("xml2js");
const fs = require("fs");
const path = require("path");

async function forEach(target, process, ...args) {
  if (Array.isArray(target)) {
    for (const t of target) {
      await process(t, ...args);
    }
  } else if (target) {
    await process(target, ...args);
  }
}

(async () => {
  try {
    const inputPath = core.getInput("path");
    const includeSummary = core.getInput("includeSummary");
    const numFailures = core.getInput("numFailures");
    const accessToken = core.getInput("access-token");
    const name = core.getInput("name");
    const globber = await glob.create(inputPath, {
      followSymbolicLinks: false,
    });

    let testSummary = new TestSummary();

    async function processTestSuite(testsuite, file) {
      await testSummary.handleTestSuite(testsuite, file, numFailures);
    }

    for await (const file of globber.globGenerator()) {
      const data = await fs.promises.readFile(file);
      let json = await parser.parseStringPromise(data);
      await forEach(json.testsuites, (testSuites) =>
        forEach(testSuites.testsuite, processTestSuite, file)
      );
      await forEach(json.testsuite, processTestSuite, file);
    }

    const annotation_level = testSummary.isFailedOrErrored() ? "failure" : "notice";
    const annotation = {
      path: "test",
      start_line: 0,
      end_line: 0,
      start_column: 0,
      end_column: 0,
      annotation_level,
      message: testSummary.toFormattedMessage(),
    };

    const conclusion = testSummary.annotations.length === 0 ? "success" : "failure";
    testSummary.annotations = [annotation, ...testSummary.annotations];

    const pullRequest = github.context.payload.pull_request;
    const link = (pullRequest && pullRequest.html_url) || github.context.ref;
    const status = "completed";
    const head_sha =
      (pullRequest && pullRequest.head.sha) || github.context.sha;
    const annotations = testSummary.annotations;

    const createCheckRequest = {
      ...github.context.repo,
      name,
      head_sha,
      status,
      conclusion,
      output: {
        title: name,
        summary: testSummary.toFormattedMessage(),
        annotations,
      },
    };

    const octokit = new github.GitHub(accessToken);
    await octokit.checks.create(createCheckRequest);
  } catch (error) {
    core.setFailed(error.message);
  }
})();

class TestSummary {

  numTests = 0;
  numSkipped = 0;
  numFailed = 0;
  numErrored = 0;
  testDuration = 0;
  annotations = [];

  async handleTestSuite(testsuite, file, maxNumFailures) {
    this.testDuration += Number(testsuite.$.time);
    this.numTests += Number(testsuite.$.tests);
    this.numErrored += Number(testsuite.$.errors);
    this.numFailed += Number(testsuite.$.failures);
    this.numSkipped += Number(testsuite.$.skipped);

    let testFunction = async (testcase) => {
      if (testcase.failure) {
        if (this.annotations.length < maxNumFailures) {
          let { filePath, line } = await findTestLocation(file, testcase);
          this.annotations.push({
            path: filePath,
            start_line: line,
            end_line: line,
            start_column: 0,
            end_column: 0,
            annotation_level: "failure",
            message: `Junit test ${testcase.name} failed ${testcase.failure.message}`,
          });
        }
      }
    };
    await forEach(testsuite.testcase, testFunction);
  }

  isFailedOrErrored() {
    return this.numFailed > 0 || this.numErrored > 0;
  }

  toFormattedMessage() {
    return `Junit Results ran ${this.numTests} in ${this.testDuration} seconds ${this.numErrored} Errored, ${this.numFailed} Failed, ${this.numSkipped} Skipped`;
  }

}

async function readJUnitReport(data, file, testSummary) {
  async function processTestSuite(testsuite, file) {
    testDuration += Number(testsuite.$.time);
    numTests += Number(testsuite.$.tests);
    numErrored += Number(testsuite.$.errors);
    numFailed += Number(testsuite.$.failures);
    numSkipped += Number(testsuite.$.skipped);
    testFunction = async (testcase) => {
      if (testcase.failure) {
        if (annotations.length < numFailures) {
          let { filePath, line } = await findTestLocation(file, testcase);
          annotations.push({
            path: filePath,
            start_line: line,
            end_line: line,
            start_column: 0,
            end_column: 0,
            annotation_level: "failure",
            message: `Junit test ${testcase.name} failed ${testcase.failure.message}`,
          });
        }
      }
    };
    await forEach(testsuite.testcase, testFunction);
  }

  let json = await parser.parseStringPromise(data);
  await forEach(json.testsuites, (testSuites) =>
      forEach(testSuites.testsuite, processTestSuite, file)
  );
  await forEach(json.testsuite, processTestSuite, file);
}

/**
 * Find the file and the line of the test method that is specified in the given test case.
 *
 * The JUnit test report files are expected to be inside the project repository, next to the sources.
 * This is true for reports generated by Gradle, maven surefire and maven failsafe.
 *
 * The strategy to find the file of the failing test is to look for candidate files having the same
 * name that the failing class' canonical name (with '.' replaced by '/'). Then, given the above
 * expectation, the nearest candidate to the test report file is selected.
 *
 * @param testReportFile the file path of the JUnit test report
 * @param testcase the JSON test case in the JUnit report
 * @returns {Promise<{line: number, filePath: string}>} the line and the file of the failing test method.
 */
async function findTestLocation(testReportFile, testcase) {
  const klass = testcase.$.classname.replace(/$.*/g, "").replace(/\./g, "/");

  // Search in src directories because some files having the same name of the class may have been
  // generated in the build folder.
  const filePathGlob = `**/src/**/${klass}.*`;
  const filePaths = await glob.create(filePathGlob, {
    followSymbolicLinks: false,
  });
  let bestFilePath;
  let bestRelativePathLength = -1;
  for await (const candidateFile of filePaths.globGenerator()) {
    let candidateRelativeLength = path.relative(testReportFile, candidateFile)
      .length;

    if (!bestFilePath || candidateRelativeLength < bestRelativePathLength) {
      bestFilePath = candidateFile;
      bestRelativePathLength = candidateRelativeLength;
    }
  }
  let line = 0;
  if (bestFilePath !== undefined) {
    const file = await fs.promises.readFile(bestFilePath, {
      encoding: "utf-8",
    });
    //TODO: make this better won't deal with methods with arguments etc
    const lines = file.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indexOf(testcase.$.name) >= 0) {
        line = i + 1; // +1 because the first line is 1 not 0
        break;
      }
    }
  } else {
    //fall back so see something
    bestFilePath = `${klass}`;
  }
  return { filePath: bestFilePath, line };
}

module.exports.findTestLocation = findTestLocation;
