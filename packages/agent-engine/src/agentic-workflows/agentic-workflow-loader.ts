import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { AgenticWorkflowConfig } from "./participant-binding.js";
import type { AgenticWorkflowModule } from "./agentic-workflow-module.js";
import {
  noopAgenticWorkflowContextStore,
  type AgenticWorkflowContextStore,
} from "./agentic-workflow-factory.js";
import type { WorkflowRunStore } from "../runs/index.js";

export interface LoadedAgenticWorkflowModules {
  modules: AgenticWorkflowModule[];
  contextStore: AgenticWorkflowContextStore;
}

export interface LoadAgenticWorkflowModulesOptions {
  workflowRunStore?: Pick<WorkflowRunStore, "readLatestSnapshot">;
}

export async function loadAgenticWorkflowModules(
  configs: readonly AgenticWorkflowConfig[],
  options: LoadAgenticWorkflowModulesOptions = {},
): Promise<LoadedAgenticWorkflowModules> {
  const modules: AgenticWorkflowModule[] = [];
  const contextStores: AgenticWorkflowContextStore[] = [];

  for (const config of configs) {
    if (config.module === undefined) {
      throw new Error(`agentic workflow "${config.name}" must declare a module`);
    }
    const loaded = await import(pathToFileURL(modulePath(config.module)).href) as ScriptModuleExports;
    const module = moduleFromExports(loaded, config);
    modules.push(module);

    const contextStore = contextStoreFromExports(loaded, options);
    if (contextStore !== undefined) contextStores.push(contextStore);
  }

  return {
    modules,
    contextStore: composeAgenticWorkflowContextStores(contextStores),
  };
}

export function composeAgenticWorkflowContextStores(
  stores: readonly AgenticWorkflowContextStore[],
): AgenticWorkflowContextStore {
  if (stores.length === 0) return noopAgenticWorkflowContextStore;
  return {
    projectInitialContext: async (input) => {
      await Promise.all(stores.map(async (store) => store.projectInitialContext?.(input)));
    },
    listContext: async (input) => {
      const listings = await Promise.all(stores.map((store) => store.listContext(input)));
      return { entries: listings.flatMap((listing) => listing.entries) };
    },
    queryContext: async (input) => {
      const results = await Promise.all(stores.map((store) => store.queryContext(input)));
      return { results: results.flatMap((result) => result.results) };
    },
  };
}

function modulePath(path: string): string {
  return isAbsolute(path) ? path : resolve(path);
}

function moduleFromExports(
  exports: ScriptModuleExports,
  config: AgenticWorkflowConfig,
): AgenticWorkflowModule {
  const candidates = [
    exports.default,
    exports.module,
    exports.agenticWorkflow,
    ...Object.values(exports),
  ];
  const module = candidates.find(isAgenticWorkflowModule);
  if (module === undefined) {
    throw new Error(`agentic workflow "${config.name}" module did not export a workflow module`);
  }
  if (module.type !== config.type) {
    throw new Error(
      `agentic workflow "${config.name}" expected module type "${config.type}" but loaded "${module.type}"`,
    );
  }
  return module;
}

function contextStoreFromExports(
  exports: ScriptModuleExports,
  options: LoadAgenticWorkflowModulesOptions,
): AgenticWorkflowContextStore | undefined {
  if (isAgenticWorkflowContextStore(exports.contextStore)) return exports.contextStore;
  if (typeof exports.createContextStore !== "function") return undefined;
  const createContextStore = exports.createContextStore;
  const store = createContextStore(options);
  if (!isAgenticWorkflowContextStore(store)) {
    throw new Error("createContextStore() did not return an agentic workflow context store");
  }
  return store;
}

function isAgenticWorkflowModule(value: unknown): value is AgenticWorkflowModule {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string" &&
    "argsSchema" in value &&
    hasParse(value.argsSchema) &&
    "createImplementation" in value &&
    typeof value.createImplementation === "function"
  );
}

function isAgenticWorkflowContextStore(value: unknown): value is AgenticWorkflowContextStore {
  return (
    typeof value === "object" &&
    value !== null &&
    "listContext" in value &&
    typeof value.listContext === "function" &&
    "queryContext" in value &&
    typeof value.queryContext === "function"
  );
}

function hasParse(value: unknown): value is { parse(input: unknown): unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "parse" in value &&
    typeof value.parse === "function"
  );
}

interface ScriptModuleExports {
  default?: unknown;
  module?: unknown;
  agenticWorkflow?: unknown;
  contextStore?: unknown;
  createContextStore?: (options: LoadAgenticWorkflowModulesOptions) => unknown;
  [key: string]: unknown;
}
