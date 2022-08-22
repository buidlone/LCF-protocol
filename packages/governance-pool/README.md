<h1 align="center">Welcome to Governance pool protocol 👋</h1>
<p>
  <a href="https://docs.buidl.one" target="_blank">
    <img alt="Documentation" src="https://img.shields.io/badge/documentation-yes-brightgreen.svg" />
  </a>
  <a href="#" target="_blank">
    <img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg" />
  </a>
</p>

## Description

> The governance pool allows for a more streamlined and efficient project management process, ensuring that all deadlines are met.

## Working principles

1. Each project will have its own id and ERC1155 token in a Governance pool, and investor votes will be represented by voting tokens.
2. After investing into project, Governance pool will mint a corresponding project tokens.
3. Investors will be able to unlock the tokens after unlock time is reached.
4. To vote against the project, investors will need to deposit voting tokens into the Governance pool with project's id.
5. If investor wants the project to continue, he/she does not need to do anything.
6. The Governance pool will then hold the funds until voting reaches the treshold percentage, which will terminate the project.
7. Investor can retract votes and transfer back the tokens if treshold was not reached yet.

## Generate documentation for smart contracts

1. Run `npx hardhat docgen`.
2. It will compile smart contracts and create new documentation page.
3. After that you can open `./docs/index.html` static website.
4. Choose the smart contract you want to look at.
5. A documentation with comments, function params and return types will be presented. NOTE: there will be contructor, events and **ALL** the functions that are available to call from the contract.
6. More information on [Github](https://github.com/ItsNickBarry/hardhat-docgen)
