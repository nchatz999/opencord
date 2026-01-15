import { type Component, createSignal, Switch, Match } from "solid-js";
import { Lock, User, Ticket, Globe } from "lucide-solid";
import { useToaster } from "../components/Toaster";
import { Input } from "../components/Input";
import Checkbox from "../components/CheckBox";
import Button from "../components/Button";
import { getDomain } from "../lib/ServerConfig";
import { useAuth } from "../store/auth";
import { useApp } from "../store/app";

type FormType = "login" | "register";

const LoginPage: Component = () => {
    const [, authActions] = useAuth();
    const [, appActions] = useApp();
    const { addToast } = useToaster();

    const [password, setPassword] = createSignal("");
    const [repeatPassword, setRepeatPassword] = createSignal("");
    const [username, setUsername] = createSignal("");
    const [inviteCode, setInviteCode] = createSignal("");
    const [rememberMe, setRememberMe] = createSignal(false);
    const [activeForm, setActiveForm] = createSignal<FormType>("login");
    const [serverDomain, setServerDomain] = createSignal(getDomain());

    const handleLogin = async (e: Event) => {
        e.preventDefault();
        if (!username() || !password() || !serverDomain()) {
            addToast("Please fill in all fields", "error");
            return;
        }

        const result = await authActions.login(username(), password(), serverDomain());

        if (result.isErr()) {
            addToast(result.error, "error");
            return;
        }

        appActions.setView({ type: "loading" });
    };

    const handleRegister = async (e: Event) => {
        e.preventDefault();
        if (!password() || !username() || !repeatPassword() || !inviteCode() || !serverDomain()) {
            addToast("Please fill in all fields", "error");
            return;
        }

        if (password() !== repeatPassword()) {
            addToast("Passwords do not match", "error");
            return;
        }

        const result = await authActions.register(username(), password(), inviteCode(), serverDomain());

        if (result.isErr()) {
            addToast(result.error, "error");
            return;
        }

        addToast("Account created successfully!", "success");
        setActiveForm("login");
    };

    const loginForm = () => (
        <>
            <form onSubmit={handleLogin} class="space-y-4">
                <Input
                    value={serverDomain()}
                    onChange={setServerDomain}
                    placeholder="Server Address"
                    icon={<Globe class="w-5 h-5 text-fg-subtle" />}
                />
                <Input
                    value={username()}
                    onChange={setUsername}
                    placeholder="Username"
                    icon={<User class="w-5 h-5 text-fg-subtle" />}
                />
                <Input
                    value={password()}
                    onChange={setPassword}
                    type="password"
                    placeholder="Password"
                    icon={<Lock class="w-5 h-5 text-fg-subtle" />}
                />
                <Checkbox
                    label="Remember me"
                    checked={rememberMe()}
                    onChange={setRememberMe}
                />
                <Button type="submit" class="w-full">
                    Log In
                </Button>
            </form>
            <p class="mt-4 text-sm text-center text-fg-subtle">
                Need an account?{" "}
                <button
                    onClick={() => setActiveForm("register")}
                    class="text-accent-primary hover:underline"
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
                    value={serverDomain()}
                    onChange={setServerDomain}
                    placeholder="Server Address"
                    icon={<Globe class="w-5 h-5 text-fg-subtle" />}
                />
                <Input
                    value={username()}
                    onChange={setUsername}
                    placeholder="Username"
                    icon={<User class="w-5 h-5 text-fg-subtle" />}
                />
                <Input
                    value={password()}
                    onChange={setPassword}
                    type="password"
                    placeholder="Password"
                    icon={<Lock class="w-5 h-5 text-fg-subtle" />}
                />
                <Input
                    value={repeatPassword()}
                    onChange={setRepeatPassword}
                    type="password"
                    placeholder="Repeat Password"
                    icon={<Lock class="w-5 h-5 text-fg-subtle" />}
                />
                <Input
                    value={inviteCode()}
                    onChange={setInviteCode}
                    placeholder="Invite Code"
                    icon={<Ticket class="w-5 h-5 text-fg-subtle" />}
                />
                <Button type="submit" class="w-full">
                    Register
                </Button>
            </form>
            <p class="mt-4 text-sm text-center text-fg-subtle">
                Already have an account?{" "}
                <button
                    onClick={() => setActiveForm("login")}
                    class="text-accent-primary hover:underline"
                >
                    Log in
                </button>
            </p>
        </>
    );

    return (
        <div class="min-h-screen bg-bg-overlay flex items-center justify-center p-4">
            <div class="w-full max-w-md bg-bg-elevated p-8 rounded-lg shadow-lg">
                <h1 class="text-3xl font-bold text-fg-emphasis mb-6 text-center">
                    <Switch>
                        <Match when={activeForm() === "login"}>Welcome Back!</Match>
                        <Match when={activeForm() === "register"}>Create an Account</Match>
                    </Switch>
                </h1>

                <Switch>
                    <Match when={activeForm() === "login"}>{loginForm()}</Match>
                    <Match when={activeForm() === "register"}>{registerForm()}</Match>
                </Switch>
            </div>
        </div>
    );
};

export default LoginPage;
