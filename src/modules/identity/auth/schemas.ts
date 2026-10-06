import { z } from "zod";

import { PASSWORD_POLICY_MAX_LENGTH as PASSWORD_MAX_LENGTH, PASSWORD_RULES } from "./password-policy";

const email = z
  .string({ error: "Enter your email address." })
  .trim()
  .toLowerCase()
  .max(254, "Email is too long.")
  .pipe(z.email({ error: "Enter a valid email address." }));

export const signUpSchema = z
  .object({
    email,
    password: z
      .string({ error: "Choose a password." })
      .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`)
      .superRefine((password, ctx) => {
        const missing = PASSWORD_RULES.filter((r) => !r.test(password)).map((r) => r.label.toLowerCase());
        if (missing.length) ctx.addIssue({ code: "custom", message: `Password needs: ${missing.join(", ")}.` });
      }),
    confirmPassword: z.string({ error: "Confirm your password." }),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    error: "Passwords do not match.",
  });

export const signInSchema = z.object({
  email,
  // No length rules on sign-in beyond a sane maximum: policy changes must not lock out users.
  password: z.string({ error: "Enter your password." }).min(1, "Enter your password.").max(PASSWORD_MAX_LENGTH),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
