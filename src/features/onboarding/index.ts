export { SetupWizard } from "./SetupWizard";
export {
  BUSINESS_TYPES,
  TABLE_CHOICES,
  businessTypeDef,
  describeSetup,
  type BusinessType,
  type BusinessTypeDef,
  type SetupAnswers,
  type SummaryLine,
} from "./setupTypes";

// ── activation: getting a brand-new owner to their first bill ────────────────
export {
  ActivationProvider,
  useActivationContext,
} from "./ActivationLayer";
export {
  useActivation,
  markSetupCompleted,
  readSetupCompletedAt,
  type Activation,
} from "./activation";

// ── the walkthrough: one whole order, on a restaurant that does not exist ────
export {
  PracticeRun,
  practiceScript,
  practiceStepCount,
  markPracticeDone,
  readPracticeDone,
  usePracticeDone,
  type PracticeStep,
  type PracticeStepId,
} from "./practice";
export { buildActivationNudges, type NudgeInput } from "./nudges";
