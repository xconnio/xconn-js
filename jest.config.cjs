module.exports = {
    transform: {
        "^.+\\.[tj]s$": "babel-jest",
    },
    extensionsToTreatAsEsm: [".ts"],
    testEnvironment: "node",
};
