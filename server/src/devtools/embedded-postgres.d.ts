// embedded-postgres ships only an "exports" field (no "main"/"types"), which
// our project's `moduleResolution: "node"` can't follow. Rather than switch
// the whole project's module resolution mode for one dev-only dependency,
// declare the shape we actually use here.
declare module "embedded-postgres" {
  interface EmbeddedPostgresOptions {
    databaseDir?: string;
    port?: number;
    user?: string;
    password?: string;
    authMethod?: "scram-sha-256" | "password" | "md5";
    persistent?: boolean;
    initdbFlags?: string[];
    postgresFlags?: string[];
    createPostgresUser?: boolean;
    onLog?: (message: unknown) => void;
    onError?: (messageOrError: unknown) => void;
  }

  export default class EmbeddedPostgres {
    constructor(options?: EmbeddedPostgresOptions);
    initialise(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    createDatabase(name: string): Promise<void>;
    dropDatabase(name: string): Promise<void>;
    getPgClient(database?: string, host?: string): import("pg").Client;
  }
}
