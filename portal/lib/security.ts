import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import sanitizeHtml from "sanitize-html";
import { supabaseAdmin } from "./supabase";

const PREFIX = "enc:v1:";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

// Função para decodificar a chave mestra de 32 bytes (armazenada em Base64)
function getSecretKey(): Buffer {
  const keyBase64 = process.env.DATABASE_ENCRYPTION_KEY;
  if (!keyBase64) {
    throw new Error("A chave mestra DATABASE_ENCRYPTION_KEY não está configurada no servidor.");
  }
  const key = Buffer.from(keyBase64.trim(), "base64");
  if (key.length !== 32) {
    throw new Error("A chave de criptografia precisa ter exatamente 32 bytes (256 bits).");
  }
  return key;
}

// Criptografar dado sensível (AES-256-GCM)
export function encryptData(plainText: string): string {
  const key = getSecretKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: AUTH_TAG_BYTES });
  
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    PREFIX.slice(0, -1), // "enc:v1"
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(":");
}

// Descriptografar dado sensível (AES-256-GCM)
export function decryptData(encryptedPayload: string): string {
  if (!encryptedPayload || !encryptedPayload.startsWith(PREFIX)) {
    return encryptedPayload; // Retorna original se não estiver criptografado
  }

  const parts = encryptedPayload.split(":");
  if (parts.length !== 5) {
    throw new Error("Formato do payload criptografado inválido.");
  }

  const iv = Buffer.from(parts[2], "base64url");
  const authTag = Buffer.from(parts[3], "base64url");
  const encrypted = Buffer.from(parts[4], "base64url");

  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    throw new Error("Parâmetros do payload corrompidos.");
  }

  const key = getSecretKey();
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: AUTH_TAG_BYTES });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

// Sanitizar entradas de HTML para evitar XSS
export function sanitizeUserInput(dirtyHtml: string): string {
  return sanitizeHtml(dirtyHtml, {
    allowedTags: ["b", "i", "em", "strong", "a", "p", "ul", "ol", "li", "br"],
    allowedAttributes: {
      "a": ["href", "target", "rel"]
    },
    allowedSchemes: ["http", "https", "mailto"]
  });
}

// Interface do Log de Auditoria
interface LogParams {
  user_id?: string;
  user_name?: string;
  user_email?: string;
  action: "create" | "edit" | "delete" | "login" | "reveal" | "search";
  entity: string;
  module_name: string;
  description: string;
}

// Gravação de Logs de Auditoria no Supabase
export async function writeLog(params: LogParams) {
  try {
    await supabaseAdmin.from("log").insert({
      user_id: params.user_id || null,
      user_name: params.user_name || "Sistema",
      user_email: params.user_email || "sistema@ncm.local",
      action: params.action,
      entity: params.entity,
      module_name: params.module_name,
      description: params.description,
      created_at: new Date().toISOString()
    });
  } catch (error) {
    console.error("Falha ao gravar log de auditoria:", error);
  }
}

// Gravação de Logs de Erros no Supabase
export async function writeErrorLog(params: {
  user_id?: string;
  user_name?: string;
  user_email?: string;
  route?: string;
  message: string;
  stack?: string;
  status_code?: number;
}) {
  try {
    await supabaseAdmin.from("error_log").insert({
      user_id: params.user_id || null,
      user_name: params.user_name || "Sistema",
      user_email: params.user_email || "sistema@ncm.local",
      route: params.route || null,
      message: params.message,
      stack: params.stack || null,
      status_code: params.status_code || 500,
      created_at: new Date().toISOString()
    });
  } catch (error) {
    console.error("Falha ao gravar log de erro no banco:", error);
  }
}
