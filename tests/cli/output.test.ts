import { printResult } from "../../src/cli/utils/output";

describe("printResult", () => {
  it("serializes BigInt values in JSON mode", () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      printResult({ json: true }, {
        nested: {
          rawAmount: 123n
        }
      });

      expect(logSpy).toHaveBeenCalledWith([
        "{",
        '  "nested": {',
        '    "rawAmount": "123"',
        "  }",
        "}"
      ].join("\n"));
    } finally {
      logSpy.mockRestore();
    }
  });
});
