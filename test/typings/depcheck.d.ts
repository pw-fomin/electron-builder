module "depcheck" {
  interface DepCheckOptions {
    ignoreDirs?: Array<string>
    parsers: { [name: string]: any; }
  }

  interface DepCheckResult {
    dependencies: Array<string>
    devDependencies: Array<string>
    missing: Array<string>

    using: { [name: string]: Array<string>; }
  }

  export default function (directory: string, options: DepCheckOptions, callback: (result: DepCheckResult) => void)
}