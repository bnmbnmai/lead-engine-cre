/**
 * sweep-usdc-to-deployer.mjs
 * Sweeps ALL USDC from every wallet in faucet-wallets.txt into the deployer.
 * Skips the deployer wallet itself. Fire-and-forget with confirmation wait.
 */
import { ethers } from 'ethers';

const RPC = 'https://sepolia.base.org';
const DEPLOYER = '0x6BBcf283847f409a58Ff984A79eFD5719D3A9F70';
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const USDC_ABI = ['function balanceOf(address) view returns (uint256)',
    'function transfer(address,uint256) returns (bool)'];

const provider = new ethers.JsonRpcProvider(RPC);

// All 31 source wallets (address, key) — deployer is destination, NOT in this list
const wallets = [
    ['0xa75d76b27fF9511354c78Cb915cFc106c6b23Dd9', '0x19216c3bfe31894b4e665dcf027d5c6981bdf653ad804cf4a9cfaeae8c0e5439'],
    ['0x55190CE8A38079d8415A1Ba15d001BC1a52718eC', '0x386ada6171840866e14a842b7343140c0a7d5f22d09199203cacc0d1f03f6618'],
    ['0x88DDA5D4b22FA15EDAF94b7a97508ad7693BDc58', '0xd4c33251ccbdfb62e5aa960f09ffb795ce828ead9ffdfeb5a96d0e74a04eb33e'],
    ['0x424CaC929939377f221348af52d4cb1247fE4379', '0x0dde9bf7cda4f0a0075ed0cf481572cdebe6e1a7b8cf0d83d6b31c5dcf6d4ca7'],
    ['0x3a9a41078992734ab24Dfb51761A327eEaac7b3d', '0xf683cedd280564b34242d5e234916f388e08ae83e4254e03367292ddf2adcea7'],
    ['0x089B6Bdb4824628c5535acF60aBF80683452e862', '0x17455af639c289b4d9347efabb3c0162db3f89e270f62813db7cf6802a988a75'],
    ['0xc92A0A5080077fb8C2B756f8F52419Cb76d99afE', '0xe5342ff07832870aecb195cd10fd3f5e34d26a3e16a9f125182adf4f93b3d510'],
    ['0xb9eDEEB25bf7F2db79c03E3175d71E715E5ee78C', '0x0a1a294a4b5ad500d87fc19a97fa8eb55fea675d72fe64f8081179af014cc7fd'],
    ['0xE10a5ba5FE03Adb833B8C01fF12CEDC4422f0fdf', '0x8b760a87e83e10e1a173990c6cd6b4aab700dd303ddf17d3701ab00e4b09750c'],
    ['0x7be5ce8824d5c1890bC09042837cEAc57a55fdad', '0x2014642678f5d0670148d8cddb76260857bb24bca6482d8f5174c962c6626382'],
    ['0x9Bb15F98982715E33a2113a35662036528eE0A36', '0x618bee99ca60f5511dad533a998344f3a0a7b2339db5726ae33d56fd543294ce'],
    ['0x28C2105E59D80a15a919CA33A6BE6Ef9FE3e05d1', '0x0889cf6cd5d134fad9f188b3e5198c8bb3bfc1ca525baecb5ebebfb36273ffb6'],
    ['0xF7E16a79822d811b1D352DbCeBB606A5eC9f6e0b', '0xe9cb1a58b0c4d8975f5f58ae66476f313ea108e0b0f7c79758f9a3867e985d2a'],
    ['0xF9c9EaD0625171Ff172DF0f9A8FAc1B399E64AF4', '0xd0dd671ddf01c918eaf284a9694e3d81e05b4968ee667e01dd6189da301e1ccd'],
    ['0xc3771E361Cc0d688aE9e4b76A9CD50eDa9F412Ad', '0x2206fc3d962595fca97534d9fb1da1186aa40e205d8d8959760324eabe041283'],
    ['0x04Fe69EAEa9aCe26613A871dF8aC598cD1380319', '0x994f19fa1c0f6ede154f0fdea0bb18b63cbae4ace3efa0ce268e7b091dff8ec9'],
    ['0xD2c2D627973687b96c6ed2C60E9C123a4aDDC2ca', '0x94d9edff9216ca3b3c167d50a74e900b0fe791bc87672ebfb68d5969c2f80efc'],
    ['0x4B9e5150Af106663709EeD7d32BB3b67A855d369', '0x71d16660634ac579891c0a191e7b346fec3bdc3b5142870cbec316ad460cb2db'],
    ['0xD33bE9c29FcFc041e3292a0406d8AEfE2a4be27A', '0xc34c62ab1a30bfb012849607a5b3341662324e7a5586e94d4338c19349808d8b'],
    ['0x6287B73Fd87d5a29698d1260F953D59e4879ECC7', '0x3ec08c170419c70b1fff2fda6c96534b8a9ee907028511ee5df12412cae1fa67'],
    ['0xe313EDD0339452D91C95EaDc47F051860DF22025', '0x50a537c401289ce27f1b9001aa6c6aa85bfecc80b65c9850674ab947ec71011b'],
    ['0xFe534B7499DFf7334bC9F0BAD09bd835bEfa7073', '0x970aa8afe6736bf5333727d58fcc82baf5ed5083992860b31bec5ba76b9c2e14'],
    ['0xE76A4132C2a8F7E20614D4637FD2A75F7Cd73675', '0x7d20781c4851156a831c1416501fe8ee61d4771ff3c16d649ba12c10644f4317'],
    ['0x6c946A614163197af1c1AbAc16CD503a92156200', '0x11376e63cb9087f93b73bc3b3176db9cf4e1394934794cde1fb7373405eccc55'],
    ['0xc2d0BB775184Cc6199Ec0D7F7529e74ae37F9aA1', '0x405ec04f53336c5164139fad710097dd2ec60905bbbe53b1570bc2743a0afcda'],
    ['0xE8436C490706064fF0805156E219c6B6C1A17BB1', '0x5210d1a51a694312f961f28cd708d1978fb0831aed5a7a13a73fe8109b804732'],
    ['0xFdC041DC2617c05C16E27389D69B15110DDE0469', '0xdd55ac24672eb6f96d9a382fa14934cb32b5e107bedf41c5b693d1a6c307ab52'],
    ['0x4f078257214f2515e04Df8804c9D6E4a55812227', '0xcbd79e6ccc1ac72ca4235ca06d257ee52256c91a66a1203cf00d5481bfb683b8'],
    ['0x35C852a447547FFb4151D8b83402b53C3E430B18', '0x2f04af05fb35cb9057520193591b3e9cc3edaa344340d8b16819a8a192913a7c'],
    ['0x73F705189f3F93f841ED870dbeF997FC35EF908c', '0x608c0243e5a03c67024ab534a7c005e550178671b1fbbaf04b3242fe4b833264'],
    ['0xB82610Aa451195269b21768A025251D5Ddb9314d', '0xbc85db2a8d67ea2d0b9d3fa74d64c240b24be4f40450f80765eea269d47156bc'],
];

// Snapshot deployer USDC before
const deployerUsdcContract = new ethers.Contract(USDC, USDC_ABI, provider);
const before = await deployerUsdcContract.balanceOf(DEPLOYER);
console.log(`\nDeployer USDC before: $${ethers.formatUnits(before, 6)}`);
console.log(`Sweeping ${wallets.length} wallets → ${DEPLOYER}\n`);

const feeData = await provider.getFeeData();
const txHashes = [];
let totalSweeping = 0n;

for (let i = 0; i < wallets.length; i++) {
    const [addr, pk] = wallets[i];
    try {
        const signer = new ethers.Wallet(pk, provider);
        const usdc = new ethers.Contract(USDC, USDC_ABI, signer);
        const bal = await usdc.balanceOf(addr);
        if (bal === 0n) {
            console.log(`  W${String(i + 1).padStart(2, '0')} ${addr.slice(0, 10)}…  $0.00  (skip)`);
            continue;
        }
        totalSweeping += bal;
        const tx = await usdc.transfer(DEPLOYER, bal, {
            maxFeePerGas: feeData.maxFeePerGas,
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
            type: 2,
        });
        txHashes.push(tx.hash);
        console.log(`  W${String(i + 1).padStart(2, '0')} ${addr.slice(0, 10)}…  $${ethers.formatUnits(bal, 6).padEnd(9)}  tx: ${tx.hash.slice(0, 20)}…`);
    } catch (err) {
        console.error(`  W${String(i + 1).padStart(2, '0')} ${addr.slice(0, 10)}…  ERROR: ${err.shortMessage ?? err.message?.slice(0, 60)}`);
    }
    await new Promise(r => setTimeout(r, 200));
}

console.log(`\n⏳  Waiting for ${txHashes.length} txs to confirm…`);
await new Promise(r => setTimeout(r, 15000));

const after = await deployerUsdcContract.balanceOf(DEPLOYER);
const gained = after - before;
console.log(`\n✅  Sweep complete`);
console.log(`   Deployer before: $${ethers.formatUnits(before, 6)}`);
console.log(`   Deployer after:  $${ethers.formatUnits(after, 6)}`);
console.log(`   Net gained:      $${ethers.formatUnits(gained > 0n ? gained : 0n, 6)}`);
console.log(`   Expected sweep:  $${ethers.formatUnits(totalSweeping, 6)}\n`);
