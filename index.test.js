const index = require("./index");
const path = require("path");
const fs = require("fs").promises;

describe("find test location", () => {
  let testReportFile;
  let testCase;

  describe("given single module archetype", () => {
    beforeAll(async () => {
      testReportFile = resolve("target/surefire-reports/TEST-dummy.xml");
      testCase = {
        $: {
          classname: "org.dummy.ClassTest",
          name: "methodTest",
        },
      };

      await addFile(
        "src/main/java/org/dummy/ClassTest.java",
        "package org.dummy;\n" +
          "class ClassTest {\n" +
          "void methodTest() { }\n" +
          "}"
      );

      await addFile("src/main/java/org/dummy2/ClassTest.java", "/* empty */");
    });

    afterAll(clearFiles);

    it("should find path of the class", async () => {
      let { filePath, line } = await index.findTestLocation(
        testReportFile,
        testCase
      );

      expect(filePath).toBe(resolve("src/main/java/org/dummy/ClassTest.java"));
    });

    it("should find line of the method", async () => {
      let { filePath, line } = await index.findTestLocation(
        testReportFile,
        testCase
      );

      expect(line).toBe(3);
    });
  });

  describe("given multiple gradle modules", () => {
    beforeAll(async () => {
      testReportFile = resolve(
        "very_long_module1/build/test-results/test/TEST-dummy.xml"
      );
      testCase = {
        $: {
          classname: "org.dummy.ClassTest",
          name: "methodTest",
        },
      };

      await addFile("src/main/java/org/dummy/ClassTest.java", "");
      await addFile(
        "very_long_module1/src/main/java/org/dummy/ClassTest.java",
        ""
      );
      await addFile("module2/src/main/java/org/dummy/ClassTest.java", "");
    });

    afterAll(clearFiles);

    it("should find path of the class in the good module", async () => {
      let { filePath, line } = await index.findTestLocation(
        testReportFile,
        testCase
      );

      expect(filePath).toBe(
        resolve("very_long_module1/src/main/java/org/dummy/ClassTest.java")
      );
    });
  });
});

describe('readTestSuites', () => {
  describe('given testsuite tag', () => {
    afterAll(clearFiles);

    it('should return single test suite', async () => {
      const filePath = 'TEST-report.xml';

      await addFile(filePath, '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<testsuite name="org.dummy.DummyTest" tests="4" skipped="1" failures="1" errors="1"' +
          ' timestamp="2020-07-21T19:20:12" hostname="dummy" time="0.132">\n' +
          '  <testcase name="test1" classname="org.dummy.DummyTest" time="0.028"/>\n' +
          '  <testcase name="test2" classname="org.dummy.DummyTest" time="0.054">\n' +
          '    <failure message="failure_message" type="failure_type">failure_text</failure>\n' +
          '  </testcase>\n' +
          '</testsuite>');

      const testSuites = await index.readTestSuites(resolve(filePath));

      expect(testSuites).toStrictEqual([{
        $: {
          name: 'org.dummy.DummyTest',
          tests: '4',
          skipped: '1',
          failures: '1',
          errors: '1',
          timestamp: '2020-07-21T19:20:12',
          hostname: 'dummy',
          time: '0.132'
        },
        testcase: [
          {
            $: {
              name: 'test1',
              classname: 'org.dummy.DummyTest',
              time: '0.028'
            }
          },
          {
            $: {
              name: 'test2',
              classname: 'org.dummy.DummyTest',
              time: '0.054'
            },
            failure: [{
              $: {
                message: 'failure_message',
                type: 'failure_type'
              },
              _: 'failure_text'
            }]
          }
        ]
      }]);
    });
  });

  describe('given testsuites tag', () => {
    afterAll(clearFiles);

    it('should return multiple test suites', async () => {
      const filePath = 'TEST-report.xml';

      await addFile(filePath, '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<testsuites>\n' +
          '  <testsuite name="org.dummy.DummyTest" tests="4" skipped="1" failures="1" errors="1"' +
          '   timestamp="2020-07-21T19:20:12" hostname="dummy" time="0.132">\n' +
          '    <testcase name="test1" classname="org.dummy.DummyTest" time="0.028"/>\n' +
          '    <testcase name="test2" classname="org.dummy.DummyTest" time="0.054">\n' +
          '      <failure message="failure_message" type="failure_type">' +
          '<![CDATA[failure_text]]></failure>\n' +
          '    </testcase>\n' +
          '  </testsuite>\n' +
          '  <testsuite name="org.dummy.DummyTest2">\n' +
          '  </testsuite>\n' +
          '</testsuites>');

      const testSuites = await index.readTestSuites(resolve(filePath));

      expect(testSuites).toStrictEqual([
        {
          $: {
            name: 'org.dummy.DummyTest',
            tests: '4',
            skipped: '1',
            failures: '1',
            errors: '1',
            timestamp: '2020-07-21T19:20:12',
            hostname: 'dummy',
            time: '0.132'
          },
          testcase: [
            {
              $: {
                name: 'test1',
                classname: 'org.dummy.DummyTest',
                time: '0.028'
              }
            },
            {
              $: {
                name: 'test2',
                classname: 'org.dummy.DummyTest',
                time: '0.054'
              },
              failure: [{
                $: {
                  message: 'failure_message',
                  type: 'failure_type'
                },
                _: 'failure_text'
              }]
            }
          ]
        },
        {
          $: {
            name: 'org.dummy.DummyTest2'
          }
        }
      ]);
    });
  });
});

async function addFile(filePath, content) {
  filePath = "tmp/" + filePath;
  let dirname = path.dirname(filePath);
  await fs.mkdir(dirname, { recursive: true });
  await fs.writeFile(filePath, content);
}

async function clearFiles() {
  await fs.rmdir("tmp", { recursive: true });
}

function resolve(filePath) {
  return path.resolve("tmp/" + filePath);
}
