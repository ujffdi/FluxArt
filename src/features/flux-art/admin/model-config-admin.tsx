"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { FlaskConical, KeyRound, Plus, RefreshCw, RotateCcw, Save, Trash2 } from "lucide-react";
import type { EditableSelectableImageModel, ModelConfigurationChange, SelectableImageModel } from "@/types/model-config";

type Preset = {
  id: string;
  label: string;
  config: EditableSelectableImageModel;
};

type AdminState = {
  configuration: SelectableImageModel;
  configurations: SelectableImageModel[];
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

const fallbackModel: EditableSelectableImageModel = {
  id: "agnes-image-2-1-flash",
  displayName: "Agnes Image 2.1 Flash",
  provider: "agnes",
  model: "agnes-image-2.1-flash",
  baseUrl: "https://apihub.agnes-ai.com/v1",
  apiKeySecretRef: "FLUXART_IMAGE_API_KEY",
  executionMode: "mock",
  requestTimeoutMs: 120000,
  enabled: true,
  isDefault: true
};

const configuredSecretPlaceholder = "__FLUXART_CONFIGURED_MODEL_API_KEY__";

function defaultSecretRefForProvider(provider: string) {
  if (provider === "openai") return "OPENAI_API_KEY";
  if (provider === "custom") return "CUSTOM_PROVIDER_API_KEY";
  return "FLUXART_IMAGE_API_KEY";
}

function isDefaultSecretRef(value: string) {
  return value === "FLUXART_IMAGE_API_KEY" || value === "OPENAI_API_KEY" || value === "CUSTOM_PROVIDER_API_KEY";
}

function editable(model: SelectableImageModel | EditableSelectableImageModel): EditableSelectableImageModel {
  return {
    id: model.id,
    displayName: model.displayName,
    provider: model.provider,
    model: model.model,
    baseUrl: model.baseUrl,
    apiKeySecretRef: model.apiKeySecretRef,
    executionMode: model.executionMode,
    requestTimeoutMs: model.requestTimeoutMs,
    enabled: model.enabled,
    isDefault: model.isDefault
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
  const [models, setModels] = useState<EditableSelectableImageModel[]>([fallbackModel]);
  const [state, setState] = useState<AdminState | undefined>();
  const [message, setMessage] = useState("");
  const [testResult, setTestResult] = useState<TestResult | undefined>();
  const [busy, setBusy] = useState<"load" | "save" | "test" | `restore:${string}` | undefined>();
  const initialLoadStarted = useRef(false);

  const adminHeaders = useMemo(() => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const secret = adminSecret.trim();
    if (secret) headers["x-fluxart-admin-secret"] = secret;
    return headers;
  }, [adminSecret]);

  const loadConfig = useCallback(async function loadConfig(secret = adminSecret, options: { quiet?: boolean } = {}) {
    setBusy("load");
    if (!options.quiet) setMessage("");
    try {
      const trimmedSecret = secret.trim();
      if (trimmedSecret) window.sessionStorage.setItem("fluxart_admin_secret", trimmedSecret);
      else window.sessionStorage.removeItem("fluxart_admin_secret");
      const response = await fetch("/api/admin/model-config", {
        headers: trimmedSecret ? { "x-fluxart-admin-secret": trimmedSecret } : undefined
      });
      const data = await parseApiResponse<AdminState>(response);
      setState(data);
      setModels(data.configurations.map(editable));
      if (!options.quiet) setMessage("配置已加载");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "配置加载失败");
    } finally {
      setBusy(undefined);
    }
  }, [adminSecret]);

  useEffect(() => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    const storedSecret = window.sessionStorage.getItem("fluxart_admin_secret") || "";
    if (storedSecret) queueMicrotask(() => setAdminSecret(storedSecret));
    void loadConfig(storedSecret);
  }, [loadConfig]);

  function patchModel(modelId: string, patch: Partial<EditableSelectableImageModel>) {
    setModels(current => current.map(model => {
      if (model.id !== modelId) return patch.isDefault ? { ...model, isDefault: false } : model;
      return { ...model, ...patch };
    }));
  }

  function addModel(model = fallbackModel) {
    const nextId = `${model.id}-${models.length + 1}`;
    setModels(current => [...current, { ...model, id: nextId, displayName: `${model.displayName} ${current.length + 1}`, isDefault: false }]);
  }

  function removeModel(modelId: string) {
    setMessage("");
    if (models.length <= 1) {
      setMessage("至少保留一个模型配置");
      return;
    }
    setModels(current => {
      const removed = current.find(model => model.id === modelId);
      const remaining = current.filter(model => model.id !== modelId);
      if (!removed?.isDefault || remaining.some(model => model.isDefault)) return remaining;
      const nextDefault = remaining.find(model => model.enabled) || remaining[0];
      return remaining.map(model => model.id === nextDefault.id ? { ...model, enabled: true, isDefault: true } : { ...model, isDefault: false });
    });
  }

  async function saveConfig() {
    setBusy("save");
    setMessage("");
    try {
      const response = await fetch("/api/admin/model-config", {
        method: "PUT",
        headers: adminHeaders,
        body: JSON.stringify({ models })
      });
      const data = await parseApiResponse<{ configuration: SelectableImageModel; configurations: SelectableImageModel[]; changes: ModelConfigurationChange[] }>(response);
      setState(previous => previous ? { ...previous, configuration: data.configuration, configurations: data.configurations, configurationSource: "data", changes: data.changes } : previous);
      setModels(data.configurations.map(editable));
      setMessage("模型列表已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "配置保存失败");
    } finally {
      setBusy(undefined);
    }
  }

  async function testConfig(model: EditableSelectableImageModel) {
    setBusy("test");
    setMessage("");
    try {
      const response = await fetch("/api/admin/model-config/test", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ config: model })
      });
      const data = await parseApiResponse<{ test: TestResult }>(response);
      setTestResult(data.test);
      setMessage(data.test.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "配置测试失败");
    } finally {
      setBusy(undefined);
    }
  }

  async function restoreConfig(changeId: string) {
    if (!window.confirm("恢复到这条历史配置？如果配置发生变化，系统会新增一条审计记录。")) return;
    setBusy(`restore:${changeId}`);
    setMessage("");
    try {
      const response = await fetch("/api/admin/model-config/restore", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ changeId })
      });
      const data = await parseApiResponse<{ configuration: SelectableImageModel; configurations: SelectableImageModel[]; changes: ModelConfigurationChange[] }>(response);
      setState(previous => previous ? { ...previous, configuration: data.configuration, configurations: data.configurations, configurationSource: "data", changes: data.changes } : previous);
      setModels(data.configurations.map(editable));
      setMessage("历史配置已恢复");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "恢复失败");
    } finally {
      setBusy(undefined);
    }
  }

  const current = state?.configuration || models.find(model => model.isDefault) || models[0];
  const currentUpdatedAt = current && "updatedAt" in current && typeof current.updatedAt === "string" ? current.updatedAt : undefined;

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
          <input className="input" type="password" value={adminSecret} placeholder="管理员账号可留空，其他账号填备用密钥" onChange={event => setAdminSecret(event.target.value)} />
          <button className="btn" type="button" onClick={() => loadConfig()} disabled={busy === "load"} title="加载配置">
            <RefreshCw size={17} aria-hidden="true" />
            加载
          </button>
        </div>
      </header>

      <section className="admin-status-grid" aria-live="polite">
        <div className="admin-metric"><span>默认模型</span><strong>{current?.displayName || "未配置"}</strong><small>{current?.provider} / {current?.model}</small></div>
        <div className="admin-metric"><span>启用模型</span><strong>{models.filter(model => model.enabled).length}</strong><small>共 {models.length} 个模型</small></div>
        <div className="admin-metric"><span>配置来源</span><strong>{state?.configurationSource || "locked"}</strong><small>{formatTime(currentUpdatedAt)}</small></div>
      </section>

      <section className="admin-grid">
        <form className="admin-panel" onSubmit={event => { event.preventDefault(); void saveConfig(); }}>
          <div className="panel-head">
            <h2>Selectable Image Models</h2>
            <span className="badge">{models.filter(model => model.enabled).length} enabled</span>
          </div>
          <div className="admin-panel-body">
            <div className="admin-presets">
              {(state?.presets || []).map(preset => (
                <button key={preset.id} className="chip" type="button" onClick={() => addModel(preset.config)}>
                  <Plus size={14} aria-hidden="true" /> {preset.label}
                </button>
              ))}
            </div>

            {models.map(model => (
              <article className="admin-change" key={model.id}>
                <div className="stack">
                  <div className="row">
                    <input className="input" value={model.displayName} aria-label="显示名称" onChange={event => patchModel(model.id, { displayName: event.target.value })} />
                    <input className="input" value={model.id} aria-label="模型 ID" onChange={event => patchModel(model.id, { id: event.target.value })} />
                  </div>
                  <div className="row">
                    <select className="select" aria-label="Execution" value={model.executionMode} onChange={(event: ChangeEvent<HTMLSelectElement>) => patchModel(model.id, { executionMode: event.target.value as "mock" | "live" })}>
                      <option value="mock">mock</option>
                      <option value="live">live</option>
                    </select>
                    <select
                      className="select"
                      aria-label="Provider"
                      value={model.provider}
                      onChange={event => {
                        const provider = event.target.value;
                        patchModel(model.id, {
                          provider,
                          ...(isDefaultSecretRef(model.apiKeySecretRef) || model.apiKeySecretRef === configuredSecretPlaceholder ? { apiKeySecretRef: defaultSecretRefForProvider(provider) } : {})
                        });
                      }}
                    >
                      <option value="agnes">agnes</option>
                      <option value="openai">openai</option>
                      <option value="custom">custom</option>
                    </select>
                  </div>
                  <input className="input" value={model.model} aria-label="Model" onChange={event => patchModel(model.id, { model: event.target.value })} />
                  <input className="input" value={model.baseUrl} aria-label="Base URL" onChange={event => patchModel(model.id, { baseUrl: event.target.value })} />
                  <div className="row">
                    <input
                      className="input"
                      value={model.apiKeySecretRef === configuredSecretPlaceholder ? "已配置，不回显" : model.apiKeySecretRef}
                      aria-label="API Key 或环境变量名"
                      placeholder="可填 OPENAI_API_KEY 或 sk-..."
                      onFocus={() => {
                        if (model.apiKeySecretRef === configuredSecretPlaceholder) patchModel(model.id, { apiKeySecretRef: "" });
                      }}
                      onBlur={() => {
                        if (!model.apiKeySecretRef.trim()) patchModel(model.id, { apiKeySecretRef: configuredSecretPlaceholder });
                      }}
                      onChange={event => patchModel(model.id, { apiKeySecretRef: event.target.value })}
                    />
                    <input className="input" type="number" min={1000} max={1800000} step={1000} value={model.requestTimeoutMs} aria-label="Timeout ms" onChange={event => patchModel(model.id, { requestTimeoutMs: Number(event.target.value) })} />
                  </div>
                  <div className="row">
                    <label className="small"><input type="checkbox" checked={model.enabled} onChange={event => patchModel(model.id, { enabled: event.target.checked })} /> enabled</label>
                    <label className="small"><input type="radio" name="default-model" checked={model.isDefault} onChange={() => patchModel(model.id, { isDefault: true })} /> default</label>
                    <button className="btn" type="button" onClick={() => void testConfig(model)} disabled={busy === "test"}><FlaskConical size={17} aria-hidden="true" /> 测试</button>
                    <button className="btn" type="button" onClick={() => removeModel(model.id)} disabled={models.length <= 1} title="删除此模型配置" aria-label="删除此模型配置"><Trash2 size={17} aria-hidden="true" /> 删除</button>
                  </div>
                </div>
              </article>
            ))}

            <div className="admin-actions">
              <button className="btn" type="button" onClick={() => addModel()} title="添加模型"><Plus size={17} aria-hidden="true" /> 添加</button>
              <button className="btn primary" type="submit" disabled={!state || busy === "save"} title="保存配置"><Save size={17} aria-hidden="true" /> 保存</button>
            </div>
            {message && <div className="admin-message">{message}</div>}
            {testResult && <div className={`admin-test-result ${testResult.status}`}><strong>{testResult.status}</strong><span>{testResult.provider} / {testResult.model} · {testResult.durationMs}ms</span></div>}
          </div>
        </form>

        <aside className="admin-panel">
          <div className="panel-head">
            <h2>Model Configuration Changes</h2>
            <span className="badge">{state?.changes.length || 0}</span>
          </div>
          <div className="admin-change-list">
            {(state?.changes || []).map(change => {
              const defaultModel = change.afterConfig.find(model => model.isDefault) || change.afterConfig[0];
              return (
                <article className="admin-change" key={change.id}>
                  <div>
                    <strong>{defaultModel?.displayName || "Model list"}</strong>
                    <span>{change.changeType} · {change.afterConfig.length} models · {formatTime(change.createdAt)}</span>
                  </div>
                  <button className="btn" type="button" onClick={() => void restoreConfig(change.id)} disabled={busy === `restore:${change.id}`} title="恢复此历史配置" aria-label="恢复此历史配置">
                    <RotateCcw size={17} aria-hidden="true" />
                    恢复
                  </button>
                </article>
              );
            })}
            {state && state.changes.length === 0 && <div className="admin-empty">暂无变更记录</div>}
            {!state && <div className="admin-empty">Locked</div>}
          </div>
        </aside>
      </section>
    </main>
  );
}
