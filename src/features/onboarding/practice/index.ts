/**
 * The practice run — a whole order, on a restaurant that does not exist.
 *
 * Public surface is deliberately small: the screen, the "has this owner had
 * it?" flag, and the pure script helpers that other code (the lesson list in
 * Account) needs to describe the run without importing the screen.
 */
export { PracticeRun, type PracticeRunProps } from "./PracticeRun";
export {
  practiceScript,
  practiceStepCount,
  type PracticeStep,
  type PracticeStepId,
} from "./practiceScript";
export {
  markPracticeDone,
  readPracticeDone,
  usePracticeDone,
} from "./practiceFlag";
