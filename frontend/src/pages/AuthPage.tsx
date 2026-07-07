import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Mail } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import { useAuth } from "../auth/AuthContext";
import { Button, ErrorState, Field, inputClass } from "../components/ui";

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});
const registerSchema = z.object({
  email: z.string().email("Enter a valid email"),
  username: z.string().min(3, "Use at least 3 characters").max(50),
  password: z.string().min(6, "Use at least 6 characters"),
});

type LoginValues = z.infer<typeof loginSchema>;
type RegisterValues = z.infer<typeof registerSchema>;

export function AuthPage({ register = false }: { register?: boolean }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const destination =
    (location.state as { from?: { pathname?: string } } | null)?.from
      ?.pathname ?? "/wardrobe";
  const loginForm = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
  });
  const registerForm = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
  });

  if (auth.user) return <Navigate to={destination} replace />;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      navigate(destination);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Something went wrong.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-paper">
      <header className="flex h-20 items-center border-b border-stone/60 px-6 sm:px-10">
        <Link to="/login" className="brand-wordmark text-2xl">
          ClosetHop
        </Link>
      </header>

      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <h1 className="font-display text-4xl tracking-tight">
            {register ? "Create an account" : "Welcome back"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-ink/50">
            {auth.mode === "local"
              ? register
                ? "A simple home for everything you wear."
                : "Sign in to open ClosetHop."
              : "Continue with Google or use a one-time email code."}
          </p>
          {error && (
            <div className="mt-5">
              <ErrorState message={error} onClose={() => setError("")} />
            </div>
          )}

          {auth.mode === "cognito" ? (
            <div className="mt-10 space-y-4">
              <Button
                className="w-full !rounded-xl"
                variant="secondary"
                disabled={busy}
                onClick={() => run(auth.signInWithGoogle)}
              >
                Continue with Google
              </Button>
              <div className="flex items-center gap-3 py-1 text-xs text-ink/35">
                <span className="h-px flex-1 bg-stone/70" />
                or
                <span className="h-px flex-1 bg-stone/70" />
              </div>
              {auth.otpPending ? (
                <>
                  <Field label="One-time code">
                    <input
                      className={`${inputClass} rounded-xl`}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="123456"
                    />
                  </Field>
                  <Button
                    className="w-full !rounded-xl"
                    disabled={busy || !code}
                    onClick={() => run(() => auth.confirmEmailOtp(code))}
                  >
                    Confirm code <ArrowRight size={17} />
                  </Button>
                </>
              ) : (
                <>
                  <Field label="Email address">
                    <input
                      className={`${inputClass} rounded-xl`}
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                    />
                  </Field>
                  <Button
                    className="w-full !rounded-xl"
                    disabled={busy || !email}
                    onClick={() => run(() => auth.requestEmailOtp(email))}
                  >
                    <Mail size={17} /> Email me a code
                  </Button>
                </>
              )}
            </div>
          ) : register ? (
            <form
              className="mt-10 space-y-5"
              onSubmit={registerForm.handleSubmit((values) =>
                run(() =>
                  auth.register(values.email, values.username, values.password),
                ),
              )}
            >
              <Field
                label="Email"
                error={registerForm.formState.errors.email?.message}
              >
                <input
                  className={inputClass}
                  type="email"
                  autoComplete="email"
                  {...registerForm.register("email")}
                />
              </Field>
              <Field
                label="Username"
                error={registerForm.formState.errors.username?.message}
              >
                <input
                  className={inputClass}
                  autoComplete="username"
                  {...registerForm.register("username")}
                />
              </Field>
              <Field
                label="Password"
                error={registerForm.formState.errors.password?.message}
              >
                <input
                  className={inputClass}
                  type="password"
                  autoComplete="new-password"
                  {...registerForm.register("password")}
                />
              </Field>
              <Button
                className="w-full !rounded-xl"
                type="submit"
                disabled={busy}
              >
                Create account <ArrowRight size={17} />
              </Button>
            </form>
          ) : (
            <form
              className="mt-10 space-y-5"
              onSubmit={loginForm.handleSubmit((values) =>
                run(() => auth.login(values.username, values.password)),
              )}
            >
              <Field
                label="Username"
                error={loginForm.formState.errors.username?.message}
              >
                <input
                  className={inputClass}
                  autoComplete="username"
                  {...loginForm.register("username")}
                />
              </Field>
              <Field
                label="Password"
                error={loginForm.formState.errors.password?.message}
              >
                <input
                  className={inputClass}
                  type="password"
                  autoComplete="current-password"
                  {...loginForm.register("password")}
                />
              </Field>
              <Button
                className="w-full !rounded-xl"
                type="submit"
                disabled={busy}
              >
                Sign in <ArrowRight size={17} />
              </Button>
            </form>
          )}
          {auth.mode === "local" && (
            <p className="mt-8 text-center text-sm text-ink/50">
              {register ? "Already have an account?" : "New to ClosetHop?"}{" "}
              <Link
                className="font-semibold text-ink underline underline-offset-4"
                to={register ? "/login" : "/register"}
              >
                {register ? "Sign in" : "Create one"}
              </Link>
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
