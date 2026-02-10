import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// ============================================
// English Translations (Default)
// ============================================

const en = {
    translation: {
        // Common
        common: {
            loading: 'Loading...',
            error: 'Error',
            success: 'Success',
            cancel: 'Cancel',
            save: 'Save',
            submit: 'Submit',
            connect: 'Connect',
            disconnect: 'Disconnect',
            viewAll: 'View All',
            search: 'Search',
            filter: 'Filter',
            clear: 'Clear',
        },

        // Navigation
        nav: {
            home: 'Home',
            marketplace: 'Marketplace',
            dashboard: 'Dashboard',
            buyerDashboard: 'Buyer Dashboard',
            sellerDashboard: 'Seller Dashboard',
            analytics: 'Analytics',
            settings: 'Settings',
        },

        // Auth
        auth: {
            connectWallet: 'Connect Wallet',
            signIn: 'Sign In',
            signOut: 'Sign Out',
            kycRequired: 'KYC verification required',
            verifyKyc: 'Verify KYC',
        },

        // Marketplace
        marketplace: {
            title: 'Marketplace',
            searchPlaceholder: 'Search by vertical, location...',
            noResults: 'No listings found',
            filters: {
                vertical: 'Vertical',
                location: 'Location',
                priceRange: 'Price Range',
                status: 'Status',
            },
        },

        // Asks
        ask: {
            create: 'Create Ask',
            edit: 'Edit Ask',
            delete: 'Delete Ask',
            vertical: 'Vertical',
            geoTargets: 'Target Locations',
            reservePrice: 'Reserve Price',
            buyNowPrice: 'Buy Now Price',
            parameters: 'Parameters',
            auctionDuration: 'Auction Duration',
            acceptOffsite: 'Accept Off-site Leads',
        },

        // Leads
        lead: {
            submit: 'Submit Lead',
            details: 'Lead Details',
            source: 'Source',
            status: 'Status',
            verified: 'Verified',
            unverified: 'Unverified',
            qualityScore: 'Quality Score',
            sources: {
                platform: 'Platform',
                api: 'API',
                offsite: 'Off-site',
            },
            statuses: {
                pending: 'Pending',
                inAuction: 'In Auction',
                reveal: 'Reveal Phase',
                sold: 'Sold',
                expired: 'Expired',
            },
        },

        // Bidding
        bid: {
            place: 'Place Bid',
            reveal: 'Reveal Bid',
            withdraw: 'Withdraw',
            amount: 'Bid Amount',
            commitment: 'Commitment',
            myBids: 'My Bids',
            highestBid: 'Highest Bid',
            currentBid: 'Current Bid',
            bidCount: 'Total Bids',
            statuses: {
                pending: 'Pending',
                revealed: 'Revealed',
                accepted: 'Won',
                outbid: 'Outbid',
                rejected: 'Rejected',
            },
        },

        // Auction
        auction: {
            live: 'Live Auction',
            ended: 'Auction Ended',
            bidding: 'Bidding Phase',
            reveal: 'Reveal Phase',
            resolved: 'Resolved',
            timeRemaining: 'Time Remaining',
            endsIn: 'Ends in',
        },

        // Dashboard
        dashboard: {
            overview: 'Overview',
            totalLeads: 'Total Leads',
            totalBids: 'Total Bids',
            wonBids: 'Won Bids',
            revenue: 'Revenue',
            spent: 'Total Spent',
            recentActivity: 'Recent Activity',
        },

        // Preferences
        preferences: {
            title: 'Preferences',
            verticals: 'Preferred Verticals',
            geoFilters: 'Geographic Filters',
            budget: 'Budget Settings',
            toggles: {
                acceptOffsite: 'Accept Off-site Leads',
                requireVerified: 'Require Verified Leads Only',
                autoAccept: 'Auto-accept Matching Leads',
            },
        },

        // Verticals
        verticals: {
            solar: 'Solar',
            mortgage: 'Mortgage',
            roofing: 'Roofing',
            insurance: 'Insurance',
            homeServices: 'Home Services',
            b2bSaas: 'B2B SaaS',
            realEstate: 'Real Estate',
            auto: 'Auto',
            legal: 'Legal',
            financial: 'Financial',
        },

        // States (US)
        states: {
            CA: 'California',
            TX: 'Texas',
            FL: 'Florida',
            NY: 'New York',
            // Add more as needed
        },
    },
};

// ============================================
// Stub Translations (For Global Readiness)
// ============================================

const es = { translation: { ...en.translation, common: { ...en.translation.common, loading: 'Cargando...' } } };
const pt = { translation: { ...en.translation, common: { ...en.translation.common, loading: 'Carregando...' } } };
const zh = { translation: { ...en.translation, common: { ...en.translation.common, loading: '加载中...' } } };
const ar = { translation: { ...en.translation, common: { ...en.translation.common, loading: 'جار التحميل...' } } };

// ============================================
// Expanded Locale Stubs (EU + APAC coverage)
// ============================================

const de = {
    translation: {
        ...en.translation,
        common: { ...en.translation.common, loading: 'Laden...', error: 'Fehler', success: 'Erfolg', cancel: 'Abbrechen', save: 'Speichern', submit: 'Einreichen', search: 'Suche', filter: 'Filter' },
        nav: { ...en.translation.nav, home: 'Startseite', marketplace: 'Marktplatz', dashboard: 'Dashboard', analytics: 'Analytik' },
        auth: { ...en.translation.auth, connectWallet: 'Wallet verbinden', signOut: 'Abmelden', kycRequired: 'KYC-Verifizierung erforderlich' },
        verticals: { solar: 'Solar', mortgage: 'Hypothek', roofing: 'Dachdeckung', insurance: 'Versicherung', homeServices: 'Hausservice', b2bSaas: 'B2B SaaS', realEstate: 'Immobilien', auto: 'Auto', legal: 'Recht', financial: 'Finanzen' },
    },
};

const fr = {
    translation: {
        ...en.translation,
        common: { ...en.translation.common, loading: 'Chargement...', error: 'Erreur', success: 'Succès', cancel: 'Annuler', save: 'Enregistrer', submit: 'Soumettre', search: 'Recherche', filter: 'Filtre' },
        nav: { ...en.translation.nav, home: 'Accueil', marketplace: 'Marché', dashboard: 'Tableau de bord', analytics: 'Analytique' },
        auth: { ...en.translation.auth, connectWallet: 'Connecter le portefeuille', signOut: 'Déconnexion', kycRequired: 'Vérification KYC requise' },
        verticals: { solar: 'Solaire', mortgage: 'Hypothèque', roofing: 'Toiture', insurance: 'Assurance', homeServices: 'Services à domicile', b2bSaas: 'B2B SaaS', realEstate: 'Immobilier', auto: 'Auto', legal: 'Juridique', financial: 'Finance' },
    },
};

const ja = {
    translation: {
        ...en.translation,
        common: { ...en.translation.common, loading: '読み込み中...', error: 'エラー', success: '成功', cancel: 'キャンセル', save: '保存', submit: '送信', search: '検索', filter: 'フィルター' },
        nav: { ...en.translation.nav, home: 'ホーム', marketplace: 'マーケットプレイス', dashboard: 'ダッシュボード', analytics: '分析' },
        auth: { ...en.translation.auth, connectWallet: 'ウォレット接続', signOut: 'サインアウト', kycRequired: 'KYC認証が必要です' },
        verticals: { solar: 'ソーラー', mortgage: '住宅ローン', roofing: '屋根', insurance: '保険', homeServices: 'ホームサービス', b2bSaas: 'B2B SaaS', realEstate: '不動産', auto: '自動車', legal: '法律', financial: '金融' },
    },
};

// ============================================
// i18n Setup
// ============================================

i18n.use(initReactI18next).init({
    resources: { en, es, pt, zh, ar, de, fr, ja },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: {
        escapeValue: false,
    },
});

export default i18n;
