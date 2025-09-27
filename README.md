# SafeLend Vault

A production-grade DeFi lending protocol with enterprise-level security practices, comprehensive testing, and automated CI/CD pipelines.

## Overview

SafeLend Vault is a decentralized lending and borrowing protocol that allows users to:
- Deposit collateral and earn yield
- Borrow against collateral with dynamic interest rates
- Liquidate undercollateralized positions
- Benefit from optimized gas costs and battle-tested security

## Features

- **Collateralized Lending**: Secure lending with over-collateralization requirements
- **Dynamic Interest Rates**: Jump rate model that adjusts based on utilization
- **Automated Liquidations**: Efficient liquidation engine with incentives
- **Multi-Chain Support**: Deploy across Ethereum, Arbitrum, and Polygon testnets
- **Gas Optimized**: Optimized for minimal gas consumption
- **Security First**: Comprehensive testing including unit, integration, and fuzz tests

## Architecture

```
contracts/
├── core/
│   ├── SafeLendVault.sol      # Main vault logic
│   ├── LendingPool.sol        # Lending functionality
│   └── Liquidator.sol         # Liquidation engine
├── interfaces/
│   ├── ISafeLendVault.sol
│   ├── ILendingPool.sol
│   └── IInterestRateModel.sol
├── libraries/
│   ├── InterestRateModel.sol
│   └── LiquidationMath.sol
└── mocks/
    └── MockERC20.sol
```

## Installation

1. Clone the repository:
```bash
git clone https://github.com/moelhaj996/SafeLend-Vault.git
cd SafeLend-Vault
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

## Testing

### Run all tests
```bash
npm test
```

### Run unit tests
```bash
npm run test:unit
```

### Run integration tests
```bash
npm run test:integration
```

### Run coverage analysis
```bash
npm run coverage
```

### Run gas reporting
```bash
npm run gas
```

### Run fuzz testing (requires Echidna)
```bash
npm run test:fuzz
```

## Deployment

### Deploy to local network
```bash
npm run node
npm run deploy:local
```

### Deploy to testnets
```bash
npm run deploy:sepolia      # Ethereum Sepolia
npm run deploy:arbitrum     # Arbitrum Sepolia
npm run deploy:polygon      # Polygon Mumbai
```

## CI/CD Pipeline

The project includes a comprehensive GitHub Actions workflow that:

1. **Testing**: Runs unit and integration tests
2. **Security Analysis**: Performs static analysis with Slither and Mythril
3. **Gas Optimization**: Generates gas consumption reports
4. **Code Quality**: Lints contracts and checks sizes
5. **Deployment**: Automated testnet deployments
6. **Docker**: Builds and publishes Docker images

## Security Features

- **Access Control**: Role-based permissions for critical functions
- **Reentrancy Protection**: Guards against reentrancy attacks
- **Pausability**: Emergency pause mechanism
- **Health Factor Checks**: Ensures positions remain collateralized
- **Liquidation Safety**: Prevents excessive liquidations
- **Interest Accrual**: Accurate interest calculations

## Interest Rate Model

The protocol uses a jump rate model with:
- Base rate: 2% APY
- Multiplier: 10% APY
- Jump multiplier: 50% APY
- Kink: 80% utilization

## Liquidation Mechanism

- Liquidation threshold: 80%
- Liquidation bonus: 5%
- Close factor: 50% (max liquidation per transaction)
- Health factor calculation based on collateral value

## Gas Optimization

- Optimized storage patterns
- Efficient interest calculations
- Batch operations support
- Minimal external calls

## Docker Support

Build and run with Docker:
```bash
docker build -t safelend-vault .
docker run -p 8545:8545 safelend-vault
```

## Smart Contract Verification

Contracts are automatically verified on block explorers after deployment. Manual verification:
```bash
npx hardhat verify --network <network> <contract-address> <constructor-args>
```

## Development Tools

- **Hardhat**: Development framework
- **OpenZeppelin**: Security-audited contract libraries
- **Echidna**: Property-based fuzz testing
- **Slither**: Static analysis
- **Mythril**: Security analysis
- **Solidity Coverage**: Test coverage analysis

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License.

## Security

For security concerns, please email moh.elnaim996@gmail.com

## Acknowledgments

- OpenZeppelin for secure contract libraries
- Hardhat team for the development framework
- Ethereum community for continuous support