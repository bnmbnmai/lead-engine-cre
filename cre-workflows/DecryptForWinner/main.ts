import {
    ConfidentialHTTPClient,
    Runner,
    CronCapability,
    consensusIdenticalAggregation,
} from "@chainlink/cre-sdk";

interface Config {
    schedule: string;
    url: string;
    owner: string;
}

const handler = Runner.newRunner<Config>((config) => {
    const cron = new CronCapability({ schedule: config.schedule });
    const httpClient = new ConfidentialHTTPClient();

    return cron.handler(async (_trigger) => {
        // Confidential HTTP call to the Lead Engine backend
        // The backend verifies the winner JWT and returns decrypted PII
        // encryptOutput: true ensures PII is encrypted for the winner's DON node only
        const response = await httpClient.sendRequest({
            url: config.url,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                owner: config.owner,
                action: "decrypt-winner-pii",
            }),
        });

        return consensusIdenticalAggregation(response);
    });
});

export default handler;
