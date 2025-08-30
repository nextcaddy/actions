import { z } from "zod";

// Base enums
export const ModeSchema     = z.enum(["save", "restore", "cleanup"]);
export const ScopeSchema    = z.enum(["global", "branch", "run"]);
export const LinkModeSchema = z.enum(["soft", "symlink", "hard"]);

export type Mode     = z.infer<typeof ModeSchema>;
export type Scope    = z.infer<typeof ScopeSchema>;
export type LinkMode = z.infer<typeof LinkModeSchema>;

// Handy constants (no magic strings)
export const Modes     = ModeSchema.enum;     // { save: "save", restore: "restore", cleanup: "cleanup" }
export const Scopes    = ScopeSchema.enum;    // { global: "global", branch: "branch", run: "run" }
export const LinkModes = LinkModeSchema.enum; // { soft: "soft", symlink: "symlink", hard: "hard" }

// Common fields
const Base = z.object({
  store: z.string(),
  link: LinkModeSchema.default(LinkModes.soft),
  verbose: z.boolean(),
  trace: z.boolean(),
  dryRun: z.boolean(),
});

// save/restore branch
const SaveRestore = Base.extend({
  mode: ModeSchema.extract([Modes.save, Modes.restore]),
  files: z.string().min(1, "'files' is required for save/restore"),
  scope: ScopeSchema, // global | branch | run
});

// cleanup branch (no global)
const Cleanup = Base.extend({
  mode: z.literal(Modes.cleanup),
  files: z.string().optional(),
  scope: ScopeSchema.exclude([Scopes.global]), // branch | run
});

// Discriminated union (nice inference & faster)
export const InputsSchema = z.discriminatedUnion("mode", [SaveRestore, Cleanup]);
export type Inputs = z.infer<typeof InputsSchema>;

// Typed state
export const StateSchema = z.object({
  preChecked: z.boolean().optional(),
  destRoot: z.string().optional(),
  runRoot: z.string().optional(),
  scope: ScopeSchema.optional(),
  dryRun: z.boolean().default(false),
  verbose: z.boolean().default(false),
  trace: z.boolean().default(false),
  cleanup: z.boolean().default(false),
});

export type State = z.infer<typeof StateSchema>;
