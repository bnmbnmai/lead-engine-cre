import { ethers } from 'ethers';

// Private mempool approach using Alchemy for atomic bundle
// 0x7E5F is watched by MEV bots, so standard RPC fails
const FALLBACK_KEY = '0x0000000000000000000000000000000000000000000000000000000000000001';
const W2_KEY = '0x386ada6171840866e14a842b7343140c0a7d5f22d09199203cacc0d1f03f6618';
const REAL_ADDR = '0x6BBcf283847f409a58Ff984A79eFD5719D3A9F70';
const FAKE_ADDR = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';
const W2_ADDR = '0x55190CE8A38079d8415A1Ba15d001BC1a52718eC';
const USDC_ADDR = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
// Use Alchemy RPC for private mempool
const ALCHEMY_KEY = 'T5X9VboAQSGophgdJ8dmv';
const RPC = `https://base-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}`;

const provider = new ethers.JsonRpcProvider(RPC);
const w2Signer = new ethers.Wallet(W2_KEY, provider);
const fallbackSigner = new ethers.Wallet(FALLBACK_KEY, provider);
const f = n => '$' + (Number(n) / 1e6).toFixed(2);

const feeData = await provider.getFeeData();
const maxFee = feeData.maxFeePerGas;
const maxPriority = feeData.maxPriorityFeePerGas || 1n;

const usdcRo = new ethers.Contract(USDC_ADDR, ['function balanceOf(address) view returns (uint256)'], provider);
const [w2Nonce, fakeNonce, fakeUsdc] = await Promise.all([
    provider.getTransactionCount(W2_ADDR, 'pending'),
    provider.getTransactionCount(FAKE_ADDR, 'pending'),
    usdcRo.balanceOf(FAKE_ADDR),
]);
console.log('0x7E5F USDC to recover:', f(fakeUsdc));

const usdcData = new ethers.Interface(['function transfer(address,uint256) returns (bool)'])
    .encodeFunctionData('transfer', [REAL_ADDR, fakeUsdc]);

const gasNeeded = 100000n * maxFee + ethers.parseEther('0.001');
const currentBlock = await provider.getBlockNumber();

// Sign ETH funding tx
const signedEth = await w2Signer.signTransaction({
    to: FAKE_ADDR, value: gasNeeded, nonce: w2Nonce, gasLimit: 21000,
    maxFeePerGas: maxFee * 3n, maxPriorityFeePerGas: maxPriority * 3n,
    chainId: 84532, type: 2,
});

// Sign USDC sweep tx
const signedUsdc = await fallbackSigner.signTransaction({
    to: USDC_ADDR, data: usdcData, nonce: fakeNonce, gasLimit: 100000,
    maxFeePerGas: maxFee * 3n, maxPriorityFeePerGas: maxPriority * 3n,
    chainId: 84532, type: 2, value: 0n,
});

console.log('Sending private bundle via Alchemy...');

// Send as private bundle using alchemy_sendPrivateTransaction (sequentially ordered)
const alchemyUrl = `https://base-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}`;

// Send ETH tx first as private
const ethResp = await fetch(alchemyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction',
        params: [signedEth]
    })
}).then(r => r.json());
console.log('ETH private tx:', ethResp.result || ethResp.error?.message);

// Quick wait
await new Promise(r => setTimeout(r, 1000));

// Send USDC tx immediately after
const usdcResp = await fetch(alchemyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'eth_sendRawTransaction',
        params: [signedUsdc]
    })
}).then(r => r.json());
console.log('USDC tx:', usdcResp.result || usdcResp.error?.message);

// Wait for confirmation
if (usdcResp.result) {
    console.log('Waiting for USDC tx confirmation...');
    let confirmed = false;
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const receipt = await provider.getTransactionReceipt(usdcResp.result);
        if (receipt) {
            console.log('USDC status:', receipt.status === 1 ? 'SUCCESS ✅' : 'FAILED ❌');
            confirmed = true;
            break;
        }
    }
    if (!confirmed) console.log('Timed out waiting for USDC receipt');
}

const [realFinal, fakeFinal] = await Promise.all([usdcRo.balanceOf(REAL_ADDR), usdcRo.balanceOf(FAKE_ADDR)]);
console.log('\n' + '═'.repeat(50));
console.log('0x6BBcf USDC final:', f(realFinal));
console.log('0x7E5F  USDC final:', f(fakeFinal));
console.log('═'.repeat(50));
