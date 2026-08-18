// Single source of truth for the parser/pipeline version stamped into every
// normalized record's provenance. Bump the relevant number when extraction
// behaviour changes, so datasets emitted by different versions stay
// distinguishable after the fact.
//
// RESEARCH-ONLY TOOLING. No network code anywhere in this directory tree.

export const PARSER_VERSION = 'ub-research/2.0.0';

/** Bumped independently when the EFPS extractor's parsing or classification
 * rules change, since EFPS records can be re-derived without re-running the
 * whole page parser. */
export const EFPS_EXTRACTOR_VERSION = 'ub-efps/1.0.0';

/** The fixed provenance source label. Every normalized record carries this so
 * a merged multi-source dataset never loses track of where a row came from. */
export const SOURCE_NAME = 'UserBenchmark';
