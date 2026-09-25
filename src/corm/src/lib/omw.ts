import type testConfig from "../../e2e/omw.test.base.json";

export type CormOmwConfig = typeof testConfig;

export type CormOmw = Omw<CormOmwConfig>;

export type CormProviderName = keyof CormOmwConfig["providers"] & string;

export type CormToolingName = keyof CormOmwConfig["tooling"] & string;

export type CormAnyProviderHandle = ProviderHandle<
  CormOmwConfig["providers"][CormProviderName]
>;

export type CormAnyToolingHandle = ToolingHandle<
  CormOmwConfig["tooling"][CormToolingName]
>;

export type CormProviderHandle<TName extends CormProviderName> = ProviderHandle<
  CormOmwConfig["providers"][TName]
>;

export type CormToolingHandle<TName extends CormToolingName> = ToolingHandle<
  CormOmwConfig["tooling"][TName]
>;
