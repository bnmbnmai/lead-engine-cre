/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_API_URL: string;
    readonly VITE_APP_URL: string;
    readonly VITE_WALLETCONNECT_PROJECT_ID: string;
    readonly VITE_ALCHEMY_API_KEY: string;
    readonly VITE_DEFAULT_CHAIN_ID: string;
    readonly VITE_ENABLE_TESTNET: string;
    readonly VITE_TESTNET_MODE: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
