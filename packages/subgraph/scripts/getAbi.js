const fs = require("fs");
const path = require("path");

const contracts = [
    "GovernancePool",
    "VotingToken",
    "InvestmentPool",
    "InvestmentPoolFactory",
    "DistributionPool",
];

const packages = ["investment-pool", "governance-pool", "distribution-pool"];

fs.mkdir("./abis/", (err) => {
    if (err) return;
    console.log("abis/ directory created");
});

packages.forEach((package) => {
    // packagePath = "{repoPath}/{packageName}-pool/artifacts/contracts"
    let packagePath = path.join(__dirname, "../..", package, "artifacts/contracts");
    fs.readdir(packagePath, (err, files) => {
        if (err) return console.log(err);
        console.log("Fetched ABIs for the following contracts:");
        files.forEach((contractDir) => {
            const contractName = contractDir.split(".")[0];
            if (!contracts.includes(contractName)) return;
            // abiFile = path/{contractName}.sol/{contractName}.json
            const abiFile = require(path.join(packagePath, contractDir, contractName));
            const abi = abiFile.abi;
            fs.writeFile(`./abis/${contractName}.json`, JSON.stringify(abi), (err) => {
                if (err) throw err;
                console.log(`- ${contractName}`);
            });
        });
    });
});
