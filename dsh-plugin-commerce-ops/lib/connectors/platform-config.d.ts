export interface PlatformConfigInput {
    readonly platform: string;
    readonly baseUrl: string;
    readonly tokenEnv: string;
}
export interface ResolvedPlatformConfig {
    readonly platform: string;
    readonly baseUrl: string;
    readonly token: string | undefined;
    readonly state: 'READY' | 'NOT_CONFIGURED';
    readonly redacted: {
        readonly platform: string;
        readonly baseUrl: string;
        readonly tokenConfigured: boolean;
    };
}
export declare function resolvePlatformConfig(input: PlatformConfigInput, env?: Record<string, string | undefined>): ResolvedPlatformConfig;
