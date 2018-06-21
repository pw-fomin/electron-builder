import { TargetSpecificOptions } from "../core"

export interface WixOptions extends TargetSpecificOptions {
  /**
   * Additional files for 'candle.exe' command
   */
  readonly candleFiles?: Array<string>

  /**
   * Additional flags for 'candle.exe' command
   */
  readonly candleFlags?: Array<string>

  /**
   * Additional files for 'light.exe' command
   */
  readonly lightFiles?: Array<string>

  /**
   * Additional flags for 'light.exe' command
   */
  readonly lightFlags?: Array<string>
}