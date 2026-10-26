import { AppErrorCode, createAppError, type AppError } from '@shared/error-codes';
import { err, ok, type Result } from '@shared/result';
import type { ClockPort } from '@domain/ports/clock-port';
import { SAVE_VERSION, type GameState } from '@domain/state/game-state';
import { encodeSave, MAX_SAVE_CHARS } from './save-codec';

/**
 * 存档导出。
 *
 * 版本号三件套（`appVersion` / `contentVersion` / `saveVersion`）全部写在 GameState.meta 里，
 * 导出文件的主体就是这个状态 JSON——不加一层包装，是为了让「导出的东西再喂给解码器」
 * 这条路保持单一实现，不必同时维护两种容器格式。
 */

export interface VersionTriple {
  readonly appVersion: string;
  readonly contentVersion: string;
  readonly saveVersion: number;
}

export interface SaveExportFile {
  readonly filename: string;
  readonly content: string;
  readonly contentType: 'application/json';
  readonly versions: VersionTriple;
}

export interface ExporterDeps {
  /** 只用于生成文件名时间戳；导出内容本身必须是纯函数结果。 */
  readonly clock: ClockPort;
}

export interface SaveExporter {
  /** 读取状态中的版本三件套；字段缺失或有误时拒绝导出。 */
  readVersions(state: GameState): Result<VersionTriple, AppError>;
  build(state: GameState): Result<SaveExportFile, AppError>;
}

export function readVersionTriple(state: GameState): Result<VersionTriple, AppError> {
  const meta = state.meta;
  if (typeof meta.appVersion !== 'string' || typeof meta.contentVersion !== 'string' ||
      !Number.isSafeInteger(meta.saveVersion)) {
    return err(createAppError(AppErrorCode.SaveRejected, '当前状态缺少完整的版本信息，无法导出'));
  }
  return ok({
    appVersion: meta.appVersion,
    contentVersion: meta.contentVersion,
    saveVersion: meta.saveVersion,
  });
}

export function createExporter(deps: ExporterDeps): SaveExporter {
  const { clock } = deps;

  return {
    readVersions: readVersionTriple,

    build(state) {
      const versions = readVersionTriple(state);
      if (!versions.ok) return err(versions.error);
      if (versions.value.saveVersion !== SAVE_VERSION) {
        return err(
          createAppError(
            AppErrorCode.SaveRejected,
            `存档版本 ${versions.value.saveVersion} 与当前程序版本 ${SAVE_VERSION} 不一致，无法导出`,
          ),
        );
      }
      const content = encodeSave(state);
      if (content.length > MAX_SAVE_CHARS) {
        return err(createAppError(AppErrorCode.SaveRejected, '存档体积超过导出上限'));
      }
      // 文件名带毫秒时间戳而非格式化日期：格式化要碰 Date，而时间在这里只能来自注入的时钟。
      return ok({
        filename: `three-kingdoms-${versions.value.appVersion}-v${versions.value.saveVersion}-${clock.now()}.json`,
        content,
        contentType: 'application/json',
        versions: versions.value,
      });
    },
  };
}
