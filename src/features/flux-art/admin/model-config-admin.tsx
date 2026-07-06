"use client";

import { useEffect, useMemo, useState } from "react";
import { FlaskConical, KeyRound, RefreshCw, RotateCcw, Save } from "lucide-react";
import type { ActiveImageModelConfiguration, EditableImageModelConfiguration, ModelConfigurationChange } from "@/types/model-config";

type Preset = {
  id: string;
  label: string;
  config: EditableImageModelConfiguration;
};

type AdminState = {
  configuration: ActiveImageModelConfiguration;
  configurationSource: "data" | "env";
  changes: ModelConfigurationChange[];
  presets: Preset[];
};

type TestResult = {
  status: "passed" | "failed";
  provider: string;
  model: string;
  durationMs: number;
  message: string;
  testedAt: string;
};

const fallbackConfig: EditableImageModelConfiguration = {
  provider: "agnes",
  model: "agnes-image-2.1-flash",
  baseUrl: "https://apihub.agnes-ai.com/v1",
  apiKeySecretRef: "FLUXART_IMAGE_API_KEY",
  executionMode: "mock",
  requestTimeoutMs: 120000
};

function editableFromActive(config: ActiveImageModelConfiguration): EditableImageModelConfiguration {
  return {
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    apiKeySecretRef: config.apiKeySecretRef,
    executionMode: config.executionMode,
    requestTimeoutMs: config.requestTimeoutMs
  };
}

function formatTime(value?: string) {
  if (!value) return "未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => undefined) as { message?: string; data?: T } | undefined;
  if (!response.ok || !body?.data) {
    throw new Error(body?.message || `HTTP ${response.status}`);
  }
  return body.data;
}

export function ModelConfigAdmin() {
  const [adminSecret, setAdminSecret] = useState("");
  const [form, setForm] = useState<EditableImageModelConfiguration>(fallbackConfig);
  const [state, setState] = useState<AdminState | undefined>();
  const [message, setMessage] = useState("");
  const [testResult, setTestResult] = useState<TestResult | undefined>();
  const [busy, setBusy] = useState<"load" | "save" | "test" | `restore:${string}` | undefined>();

  useEffect(() => {
    const storedSecret = window.sessionStorage.getItem("fluxart_admin_secret");
    if (storedSecret) queueMicrotask(() => setAdminSecret(storedSecret));
  }, []);

  const adminHeaders = useMemo(() => ({
    "Content-Type": "application/json",
    "x-fluxart-admin-secret": adminSecret
  }), [adminSecret]);

  async function loadConfig(secret = adminSecret) {
    if (!secret) {
      setMessage("请输入管理员密钥");
      return;
    }
    setBusy("load");
    setMessage("");
    try {
      window.sessionStorage.setItem("fluxart_admin_secret", secret);
      const response = await fetch("/api/admin/model-config", {
        headers: { "x-fluxart-admin-secret": secret }
      });
      const data = await parseApiResponse<AdminState>(response);
      setState(data);
      setForm(editableFromActive(data.configuration));
      setMessage("配置已加载");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "配置加载失败");
    } finally {
      setBusy(undefined);
    }
  }

  async function saveConfig() {
    setBusy("save");
    setMessage("");
    try {
      const response = await fetch("/api/admin/model-config", {
        method: "PUT",
        headers: adminHeaders,
        body: JSON.stringify({ config: form })
      });
      const data = await parseApiResponse<{ configuration: ActiveImageModelConfiguration; changes: ModelConfigurationChange[] }>(response);
      setState(previous => previous ? { ...previous, configuration: data.configuration, configurationSource: "data", changes: data.changes } : previous);
      setMessage(form.executionMode === "live" ? "已保存，当前 live 配置未测试" : "配置已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "配置保存失败");
    } finally {
      setBusy(undefined);
    }
  }

  async function testConfig() {
    setBusy("test");
    setMessage("");
    try {
      const response = await fetch("/api/admin/model-config/test", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ config: form })
      });
      const data = await parseApiResponse<{ test: TestResult }>(response);
      setTestResult(data.test);
      setMessage(data.test.message);
      await loadConfig();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "配置测试失败");
    } finally {
      setBusy(undefined);
    }
  }

  async function restoreConfig(changeId: string) {
    setBusy(`restore:${changeId}`);
    setMessage("");
    try {
      const response = await fetch("/api/admin/model-config/restore", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ changeId })
      });
      const data = await parseApiResponse<{ configuration: ActiveImageModelConfiguration; changes: ModelConfigurationChange[] }>(response);
      setState(previous => previous ? { ...previous, configuration: data.configuration, configurationSource: "data", changes: data.changes } : previous);
      setForm(editableFromActive(data.configuration));
      setMessage("历史配置已恢复");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "恢复失败");
    } finally {
      setBusy(undefined);
    }
  }

  function patchForm(patch: Partial<EditableImageModelConfiguration>) {
    setForm(current => ({ ...current, ...patch }));
  }

  const current = state?.configuration;

  return (
    <main className="admin-page">
      <header className="admin-top">
        <div className="brand">
          <span className="mark" />
          <div>
            <strong>Flux Art</strong>
            <span>Model Administration</span>
          </div>
        </div>
        <div className="admin-unlock">
          <KeyRound size={17} aria-hidden="true" />
          <input
            className="input"
            type="password"
            value={adminSecret}
            placeholder="FLUXART_ADMIN_SECRET"
            onChange={event => setAdminSecret(event.target.value)}
          />
          <button className="btn" type="button" onClick={() => loadConfig()} disabled={busy === "load"} title="加载配置">
            <RefreshCw size={17} aria-hidden="true" />
            加载
          </button>
        </div>
      </header>

      <section className="admin-status-grid" aria-live="polite">
        <div className="admin-metric">
          <span>当前模型</span>
          <strong>{current?.model || form.model}</strong>
          <small>{current?.provider || form.provider}</small>
        </div>
        <div className="admin-metric">
          <span>测试状态</span>
          <strong className={current?.lastTestStatus === "passed" ? "ok" : current?.lastTestStatus === "failed" ? "bad" : "wait"}>
            {current?.lastTestStatus || "untested"}
          </strong>
          <small>{formatTime(current?.lastTestedAt)}</small>
        </div>
        <div className="admin-metric">
          <span>配置来源</span>
          <strong>{state?.configurationSource || "locked"}</strong>
          <small>{formatTime(current?.updatedAt)}</small>
        </div>
      </section>

      <section className="admin-grid">
        <form className="admin-panel" onSubmit={event => { event.preventDefault(); void saveConfig(); }}>
          <div className="panel-head">
            <h2>Active Image Model Configuration</h2>
            <span className="badge">{form.executionMode}</span>
          </div>
          <div className="admin-panel-body">
            <div className="admin-presets">
              {(state?.presets || []).map(preset => (
                <button key={preset.id} className="chip" type="button" onClick={() => setForm(preset.config)}>
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="row">
              <label className="field">
                <span>Execution</span>
                <select className="select" value={form.executionMode} onChange={event => patchForm({ executionMode: event.target.value as "mock" | "live" })}>
                  <option value="mock">mock</option>
                  <option value="live">live</option>
                </select>
              </label>
              <label className="field">
                <span>Provider</span>
                <select className="select" value={form.provider} onChange={event => patchForm({ provider: event.target.value })}>
                  <option value="agnes">agnes</option>
                  <option value="openai">openai</option>
                  <option value="custom">custom</option>
                </select>
              </label>
            </div>

            <label className="field">
              <span>Model</span>
              <input className="input" value={form.model} onChange={event => patchForm({ model: event.target.value })} />
            </label>
            <label className="field">
              <span>Base URL</span>
              <input className="input" value={form.baseUrl} onChange={event => patchForm({ baseUrl: event.target.value })} />
            </label>

            <div className="row">
              <label className="field">
                <span>Secret Ref</span>
                <input className="input" value={form.apiKeySecretRef} onChange={event => patchForm({ apiKeySecretRef: event.target.value })} />
              </label>
              <label className="field">
                <span>Timeout ms</span>
                <input
                  className="input"
                  type="number"
                  min={1000}
                  max={1800000}
                  step={1000}
                  value={form.requestTimeoutMs}
                  onChange={event => patchForm({ requestTimeoutMs: Number(event.target.value) })}
                />
              </label>
            </div>

            <div className="admin-actions">
              <button className="btn" type="button" onClick={() => void testConfig()} disabled={!state || busy === "test"} title="测试配置">
                <FlaskConical size={17} aria-hidden="true" />
                测试
              </button>
              <button className="btn primary" type="submit" disabled={!state || busy === "save"} title="保存配置">
                <Save size={17} aria-hidden="true" />
                保存
              </button>
            </div>

            {message && <div className="admin-message">{message}</div>}
            {testResult && (
              <div className={`admin-test-result ${testResult.status}`}>
                <strong>{testResult.status}</strong>
                <span>{testResult.provider} / {testResult.model} · {testResult.durationMs}ms</span>
              </div>
            )}
          </div>
        </form>

        <aside className="admin-panel">
          <div className="panel-head">
            <h2>Model Configuration Changes</h2>
            <span className="badge">{state?.changes.length || 0}</span>
          </div>
          <div className="admin-change-list">
            {(state?.changes || []).map(change => (
              <article className="admin-change" key={change.id}>
                <div>
                  <strong>{change.afterConfig.model}</strong>
                  <span>{change.changeType} · {change.afterConfig.provider} · {formatTime(change.createdAt)}</span>
                </div>
                <button
                  className="btn icon"
                  type="button"
                  onClick={() => void restoreConfig(change.id)}
                  disabled={busy === `restore:${change.id}`}
                  title="恢复此配置"
                  aria-label="恢复此配置"
                >
                  <RotateCcw size={17} aria-hidden="true" />
                </button>
              </article>
            ))}
            {state && state.changes.length === 0 && <div className="admin-empty">暂无变更记录</div>}
            {!state && <div className="admin-empty">Locked</div>}
          </div>
        </aside>
      </section>
    </main>
  );
}
