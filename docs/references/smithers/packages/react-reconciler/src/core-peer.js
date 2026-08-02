
/** @typedef {import("@smthrs/graph/types").ExtractGraph} ExtractGraph */
const GRAPH_SPECIFIER = "@smthrs/graph";
const LOCAL_GRAPH_SPECIFIER = "../../graph/src/index.js";
/**
 * @param {string} specifier
 * @returns {Promise<CoreModule | null>}
 */
async function importCoreModule(specifier) {
    try {
        return (await import(specifier));
    }
    catch {
        return null;
    }
}
/**
 * @returns {Promise<ExtractGraph>}
 */
export async function resolveExtractGraph() {
    const modules = [
        await importCoreModule(GRAPH_SPECIFIER),
        await importCoreModule(LOCAL_GRAPH_SPECIFIER),
    ];
    for (const mod of modules) {
        const fn = mod?.extractGraph;
        if (typeof fn === "function") {
            return fn;
        }
    }
    throw new Error("Unable to load extractGraph from @smthrs/graph. " +
        "Install @smthrs/graph and ensure it exports extractGraph.");
}
