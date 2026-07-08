import { describe, expect, it } from "bun:test";
import * as Exit from "effect/Exit";
import {
  decodeRequestUserInputInputExit,
  decodeRequestUserInputResultExit,
  type RequestUserInputInput,
  type RequestUserInputResult,
} from "./request-user-input-contracts";

function expectSuccess<A>(exit: Exit.Exit<A, unknown>): A {
  expect(Exit.isSuccess(exit)).toBe(true);
  if (Exit.isSuccess(exit)) return exit.value;
  throw new Error("Expected decode success.");
}

describe("request_user_input extension contracts", () => {
  it("decodes choice and freeform questions without runtime-only fields", () => {
    expect(
      expectSuccess<RequestUserInputInput>(
        decodeRequestUserInputInputExit({
          questions: [
            {
              title: "CI scope",
              question: "Should CI run only unit checks or the full suite before handoff?",
              options: [
                {
                  label: "Unit checks only",
                  description: "Faster; catches type, lint, format, and unit regressions.",
                  recommended: true,
                },
                {
                  label: "Full suite",
                  description: "Slower; also verifies e2e behavior.",
                },
              ],
            },
            {
              title: "Release note tone",
              question: "What release-note tone should I use?",
              defaultAnswer: "Concise engineering summary focused on user-visible changes.",
            },
          ],
        }),
      ),
    ).toEqual({
      questions: [
        {
          title: "CI scope",
          question: "Should CI run only unit checks or the full suite before handoff?",
          options: [
            {
              label: "Unit checks only",
              description: "Faster; catches type, lint, format, and unit regressions.",
              recommended: true,
            },
            {
              label: "Full suite",
              description: "Slower; also verifies e2e behavior.",
            },
          ],
        },
        {
          title: "Release note tone",
          question: "What release-note tone should I use?",
          defaultAnswer: "Concise engineering summary focused on user-visible changes.",
        },
      ],
    });
  });

  it("rejects ids, mode, old field names, and ambiguous defaults", () => {
    expect(
      Exit.isFailure(
        decodeRequestUserInputInputExit({
          mode: "blocking",
          questions: [
            {
              id: "ci_scope",
              header: "CI scope",
              prompt: "Should CI run only unit checks or the full suite?",
              inputKind: "single_choice",
            },
          ],
        }),
      ),
    ).toBe(true);

    expect(
      Exit.isFailure(
        decodeRequestUserInputInputExit({
          questions: [
            {
              title: "CI scope",
              question: "Should CI run only unit checks or the full suite?",
              defaultAnswer: "Unit checks only.",
              options: [
                {
                  label: "Unit checks only",
                  description: "Faster.",
                  recommended: true,
                },
                {
                  label: "Full suite",
                  description: "Slower.",
                },
              ],
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("rejects choice questions without exactly one true recommended option", () => {
    expect(
      Exit.isFailure(
        decodeRequestUserInputInputExit({
          questions: [
            {
              title: "CI scope",
              question: "Should CI run only unit checks or the full suite?",
              options: [
                {
                  label: "Unit checks only",
                  description: "Faster.",
                },
                {
                  label: "Full suite",
                  description: "Slower.",
                },
              ],
            },
          ],
        }),
      ),
    ).toBe(true);

    expect(
      Exit.isFailure(
        decodeRequestUserInputInputExit({
          questions: [
            {
              title: "CI scope",
              question: "Should CI run only unit checks or the full suite?",
              options: [
                {
                  label: "Unit checks only",
                  description: "Faster.",
                  recommended: true,
                },
                {
                  label: "Full suite",
                  description: "Slower.",
                  recommended: false,
                },
              ],
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("decodes the model-facing result without ids or UI state", () => {
    expect(
      expectSuccess<RequestUserInputResult>(
        decodeRequestUserInputResultExit({
          answers: [
            {
              title: "CI scope",
              question: "Should CI run only unit checks or the full suite?",
              answer: {
                kind: "option",
                label: "Unit checks only",
                text: "Unit checks only",
              },
              answeredBy: "default",
            },
            {
              title: "Release note tone",
              question: "What release-note tone should I use?",
              answer: {
                kind: "custom",
                text: "Concise engineering summary.",
              },
              answeredBy: "user",
            },
          ],
        }),
      ),
    ).toEqual({
      answers: [
        {
          title: "CI scope",
          question: "Should CI run only unit checks or the full suite?",
          answer: {
            kind: "option",
            label: "Unit checks only",
            text: "Unit checks only",
          },
          answeredBy: "default",
        },
        {
          title: "Release note tone",
          question: "What release-note tone should I use?",
          answer: {
            kind: "custom",
            text: "Concise engineering summary.",
          },
          answeredBy: "user",
        },
      ],
    });

    expect(
      Exit.isFailure(
        decodeRequestUserInputResultExit({
          answers: [
            {
              requestId: "rui_01",
              title: "CI scope",
              question: "Should CI run only unit checks or the full suite?",
              answer: {
                kind: "option",
                label: "Unit checks only",
                text: "Unit checks only",
              },
              answeredBy: "default",
            },
          ],
        }),
      ),
    ).toBe(true);
  });
});
