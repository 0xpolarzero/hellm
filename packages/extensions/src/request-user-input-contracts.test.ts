import { describe, expect, it } from "bun:test";
import {
  decodeRequestUserInputInput,
  decodeRequestUserInputResult,
} from "./request-user-input-contracts";

describe("request_user_input extension contracts", () => {
  it("decodes choice and freeform questions without runtime-only fields", () => {
    expect(
      decodeRequestUserInputInput({
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
      }) as unknown,
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
    expect(() =>
      decodeRequestUserInputInput({
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
    ).toThrow();

    expect(() =>
      decodeRequestUserInputInput({
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
    ).toThrow();
  });

  it("rejects choice questions without exactly one true recommended option", () => {
    expect(() =>
      decodeRequestUserInputInput({
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
    ).toThrow();

    expect(() =>
      decodeRequestUserInputInput({
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
    ).toThrow();
  });

  it("decodes the model-facing result without ids or UI state", () => {
    expect(
      decodeRequestUserInputResult({
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
      }) as unknown,
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

    expect(() =>
      decodeRequestUserInputResult({
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
    ).toThrow();
  });
});
