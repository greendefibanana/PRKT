module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  moduleFileExtensions: ["ts", "js", "json"],
  collectCoverageFrom: ["src/**/*.ts"],
  coverageThreshold: {
    "./src/policy/**/*.ts": {
      branches: 50,
      functions: 70,
      lines: 70,
      statements: 70
    }
  }
};
