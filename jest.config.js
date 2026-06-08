process.env.NODE_ENV = "test";

export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
  testPathIgnorePatterns: ["<rootDir>/tests/e2e/"],
  // Ignore the packaged backend staging trees — their package.json files
  // otherwise collide in jest's haste module map ("erp-backend-runtime").
  modulePathIgnorePatterns: ["<rootDir>/src-tauri/"],
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1"
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true
      }
    ]
  }
};
