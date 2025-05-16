module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    coverageThreshold: {
        global: {
            "branches": 90,
            "functions": 85,
            "lines": 90,
            "statements": 90
        }
    }
};
