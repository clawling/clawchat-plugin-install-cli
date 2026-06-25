import type { ClawchatTarget } from "../config";
import type { TargetAuth } from "../auth/types";
import type { FetchLike } from "../http/client";

export type MethodName =
  | "activate"
  | "get_account_profile"
  | "get_user_profile"
  | "list_account_friends"
  | "update_account_profile"
  | "upload_avatar_image"
  | "upload_media_file";

export interface MethodContext {
  target: ClawchatTarget;
  baseUrl: string;
  auth: TargetAuth | null;
  fetchFn?: FetchLike;
}
