import { type Component, createSignal, Switch, Match } from "solid-js";
import { Lock, Mail, User, Ticket } from "lucide-solid";
import { useToaster } from "../components/Toaster";
import { Input } from "../components/Input";
import Checkbox from "../components/CheckBox";
import Button from "../components/Button";
import { match } from "opencord-utils";
import { fetchApi } from "../utils";
import { userDomain } from "../store";
import { saveSession } from "../contexts/Session";

type FormType = "login" | "register" | "forgot-password";

const AuthPage: Component = () => {
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [repeatPassword, setRepeatPassword] = createSignal("");
  const [username, setUsername] = createSignal("");
  const [inviteCode, setInviteCode] = createSignal("");
  const [rememberMe, setRememberMe] = createSignal(false);
  const [activeForm, setActiveForm] = createSignal<FormType>("login");

  const { addToast } = useToaster();

  const handleLogin = async (e: Event) => {
    e.preventDefault();
    if (username() && password()) {
      const ans = await fetchApi<{ session_token: string; expires_at?: string, user_id: number }>("/auth/login", {
        method: "POST",
        body: { username: username(), password: password() },
      });
      match(ans, {
        ok: (val) => {

          saveSession(val.session_token, val.user_id);
          userDomain.setAppState({ type: "loading" })
        },
        err: (error) => {
          const message =
            (error as any)?.reason || (error as any)?.message || "Login failed";
          addToast(message, "error");
        },
      });
    } else {
      addToast("Please fill in all fields", "error");
    }
  };

  const handleRegister = async (e: Event) => {
    e.preventDefault();
    if (password() && username() && repeatPassword() && inviteCode()) {
      if (password() !== repeatPassword()) {
        addToast("Passwords do not match", "error");
      } else {
        const ans = await fetchApi<{ user: any }>("/auth/register", {
          method: "POST",
          body: {
            username: username(),
            password: password(),
            invite_code: inviteCode(),
          },
        });
        match(ans, {
          ok: () => {
            addToast("Account created successfully!", "success");
            setActiveForm("login");
          },
          err: (error) => {
            addToast(error.reason, "error");
          },
        });
      }
    } else {
      addToast("Please fill in all fields", "error");
    }
  };

  const handleForgotPassword = async (e: Event) => {
    e.preventDefault();
  };

  const loginForm = () => (
    <>
      <form onSubmit={handleLogin} class="space-y-4">
        <Input
          value={username()}
          onChange={setUsername}
          placeholder="Username"
          icon={<User class="w-5 h-5 text-[#72767d]" />}
        />
        <Input
          value={password()}
          onChange={setPassword}
          type="password"
          placeholder="Password"
          icon={<Lock class="w-5 h-5 text-[#72767d]" />}
        />
        <div class="flex items-center justify-between">
          <Checkbox
            label="Remember me"
            checked={rememberMe()}
            onChange={setRememberMe}
          />
          <button
            type="button"
            onClick={() => setActiveForm("forgot-password")}
            class="text-sm text-[#5865f2] hover:underline"
          >
            Forgot password?
          </button>
        </div>
        <Button type="submit" class="w-full">
          Log In
        </Button>
      </form>
      <p class="mt-4 text-sm text-center text-[#72767d]">
        Need an account?{" "}
        <button
          onClick={() => setActiveForm("register")}
          class="text-[#5865f2] hover:underline"
        >
          Register
        </button>
      </p>
    </>
  );

  const registerForm = () => (
    <>
      <form onSubmit={handleRegister} class="space-y-4">
        <Input
          value={username()}
          onChange={setUsername}
          placeholder="Username"
          icon={<User class="w-5 h-5 text-[#72767d]" />}
        />
        <Input
          value={password()}
          onChange={setPassword}
          type="password"
          placeholder="Password"
          icon={<Lock class="w-5 h-5 text-[#72767d]" />}
        />
        <Input
          value={repeatPassword()}
          onChange={setRepeatPassword}
          type="password"
          placeholder="Repeat Password"
          icon={<Lock class="w-5 h-5 text-[#72767d]" />}
        />
        <Input
          value={inviteCode()}
          onChange={setInviteCode}
          placeholder="Invite Code"
          icon={<Ticket class="w-5 h-5 text-[#72767d]" />}
        />
        <Button type="submit" class="w-full">
          Register
        </Button>
      </form>
      <p class="mt-4 text-sm text-center text-[#72767d]">
        Already have an account?{" "}
        <button
          onClick={() => setActiveForm("login")}
          class="text-[#5865f2] hover:underline"
        >
          Log in
        </button>
      </p>
    </>
  );

  const forgotPasswordForm = () => (
    <>
      <form onSubmit={handleForgotPassword} class="space-y-4">
        <Input
          value={email()}
          onChange={setEmail}
          placeholder="Email"
          icon={<Mail class="w-5 h-5 text-[#72767d]" />}
        />
        <Button type="submit" class="w-full">
          Reset Password
        </Button>
      </form>
      <p class="mt-4 text-sm text-center text-[#72767d]">
        Remember your password?{" "}
        <button
          onClick={() => setActiveForm("login")}
          class="text-[#5865f2] hover:underline"
        >
          Log in
        </button>
      </p>
    </>
  );


  return (
    <div class="min-h-screen bg-[#36393f] flex items-center justify-center p-4">
      <div class="w-full max-w-md bg-[#2f3136] p-8 rounded-lg shadow-lg">
        <h1 class="text-3xl font-bold text-white mb-6 text-center">
          <Switch>
            <Match when={activeForm() === "login"}>Welcome Back!</Match>
            <Match when={activeForm() === "register"}>Create an Account</Match>
            <Match when={activeForm() === "forgot-password"}>
              Reset Password
            </Match>
          </Switch>
        </h1>

        <Switch>
          <Match when={activeForm() === "login"}>{loginForm()}</Match>
          <Match when={activeForm() === "register"}>{registerForm()}</Match>
          <Match when={activeForm() === "forgot-password"}>
            {forgotPasswordForm()}
          </Match>
        </Switch>
      </div>
    </div>
  );
};

export default AuthPage;
