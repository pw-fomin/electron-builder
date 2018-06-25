import { Arch, deepAssign } from "builder-util"
import { UUID } from "builder-util-runtime"
import { writeFile } from "fs-extra-p"
import * as path from "path"
import * as fs from "fs"
import * as crypto from "crypto"
import { WixOptions } from "../"
import { Target } from "../core"
import { VmManager } from "../vm/vm"
import { WineVmManager } from "../vm/WineVm"
import { WinPackager } from "../winPackager"
import { createStageDir } from "./targetUtil"

export default class WixTarget extends Target {
  private readonly vm = process.platform === "win32" ? new VmManager() : new WineVmManager()

  readonly options: WixOptions = deepAssign(this.packager.platformSpecificBuildOptions, this.packager.config.wix)

  constructor(private readonly packager: WinPackager, readonly outDir: string) {
    super("wix")
  }

  async build(appOutDir: string, arch: Arch) {
    const packager = this.packager
    const artifactName = packager.expandArtifactNamePattern(this.options, "msi", arch)
    const artifactPath = path.join(this.outDir, artifactName)
    this.logBuilding("WIX", artifactPath, arch)

    const stageDir = await createStageDir(this, packager, arch)
    const vm = this.vm

    const candleFiles = this.options.candleFiles || []
    const candleFlags = this.options.candleFlags || []
    const lightFiles = this.options.lightFiles || []
    const lightFlags = this.options.lightFlags || []
    const appInfo = this.packager.appInfo
    const mainExeFileName = `${appInfo.productFilename}.exe`

    const wixApplicationFiles = stageDir.getTempFile('ApplicationFiles.wxs')
    let generatedFilesData = this.generateWixSources(appOutDir, mainExeFileName, arch)
    await writeFile(wixApplicationFiles, generatedFilesData)
    candleFiles.push(wixApplicationFiles)

    const candleArgs = [
      '-nologo',
      '-pedantic',
      `-dAppDir=${vm.toVmFile(appOutDir)}`,
      `-dMainExeFileName=${mainExeFileName}`
    ]
    candleArgs.push(...candleFlags)

    for (var filename of candleFiles) {
      const outputFilename = path.join(stageDir.dir, path.basename(filename).replace('.wxs', '.wxsobj'))
      await vm.exec(vm.toVmFile('candle.exe'), candleArgs.concat('-out', outputFilename, filename), {
        cwd: stageDir.dir
      })
      lightFiles.push(outputFilename)
    }

    await this.light(lightFiles, lightFlags, vm, artifactPath, appOutDir, stageDir.dir)

    await stageDir.cleanup()

    await packager.sign(artifactPath)

    packager.info.dispatchArtifactCreated({
      file: artifactPath,
      packager,
      arch,
      safeArtifactName: packager.computeSafeArtifactName(artifactName, "msi"),
      target: this,
      isWriteUpdateInfo: false,
    })
  }

  private async light(objectFiles: Array<string>, lightFlags: Array<string>, vm: VmManager, artifactPath: string, appOutDir: string, tempDir: string) {
    const appSize = this.getSize(appOutDir)

    const lightArgs = [
      '-nologo',
      '-pedantic',
      `-dAppSize=${appSize}`,
      '-spdb',
      '-sacl',
      '-out',
      vm.toVmFile(artifactPath)
    ]
    lightArgs.push(...lightFlags)
    lightArgs.push(...objectFiles)

    await vm.exec(vm.toVmFile('light.exe'), lightArgs, {
      cwd: tempDir
    })
  }

  private getSize(inputPath: string): number {
    const stat = fs.statSync(inputPath);
    if (stat.isFile()) {
      return stat.size
    } else if (stat.isDirectory()) {
      const files = fs.readdirSync(inputPath)
      return files.reduce((accumulator, file) => accumulator + this.getSize(path.join(inputPath, file)), 0)
    }
    return 0
  }

  private collectDirs(inputPath: string, rootName: string): DirInfo | null {
    const stat = fs.statSync(inputPath)
    if (stat.isDirectory()) {
      const items = fs.readdirSync(inputPath)

      const subDirs: Array<DirInfo> = []
      for (const item of items) {
        const dirInfo = this.collectDirs(path.join(inputPath, item), item)
        if (dirInfo) {
          subDirs.push(dirInfo)
        }
      }
      return { dirname: rootName, dirpath: inputPath, children: subDirs }
    }
    return null
  }

  private generateId(dirpath: string): string {
    const md5 = crypto.createHash('md5')
    md5.update(dirpath)
    return '_' + md5.digest('hex')
  }

  private formatWixDirectories(directories: Array<DirInfo>, currentTabulation: string, tabulation: string): string {
    let result = ''

    if (!directories) {
      return result
    }

    for (const dir of directories) {
      const directoryId = this.generateId(dir.dirpath)
      const subDirs = this.formatWixDirectories(dir.children, currentTabulation + tabulation, tabulation)

      result += `${currentTabulation}<Directory Id="${directoryId}" Name="${dir.dirname}"`
      if (subDirs) {
        result += `>\n${subDirs}${currentTabulation}</Directory>\n`
      } else {
        result += '/>\n'
      }
    }

    return result
}

  private formatWixComponents(
    directories: DirInfo| Array<DirInfo> | null,
    presetDictionaryId: string | null,
    mainExeFileName: string,
    arch: Arch,
    currentTabulation: string,
    tabulation: string
): string {
    let result = ''

    if (!directories) {
      return result
    } else if (!Array.isArray(directories)) {
      directories = [directories]
    }

    const isWin64 = arch === Arch.ia32 ? 'no' : 'yes'

    for (const dir of directories) {
      const directoryId = presetDictionaryId || this.generateId(dir.dirpath)
      const componentId = `${directoryId}_component`
      const removeFolderId = `${directoryId}_uninstall`
      const componentGuid = UUID.v1().toUpperCase()
      let componentElement = `${currentTabulation}<Component Id="${componentId}" Guid="${componentGuid}" Directory="${directoryId}" DiskId="1" KeyPath="yes" Win64="${isWin64}">\n`

      const dirItems = fs.readdirSync(dir.dirpath)
      for (const item of dirItems) {
        if (item === mainExeFileName) {
          // mainExeFileName handles separetly in outside .wxs file
          continue
        }

        const itemPath = path.join(dir.dirpath, item)
        const stat = fs.statSync(itemPath)
        if (stat.isFile()) {
          const fileId = this.generateId(itemPath)
          componentElement += `${currentTabulation}${tabulation}<File Id="${fileId}" Name="${item}" Vital="yes" Source="${itemPath}"/>\n`
        }
      }

      componentElement += `\n${currentTabulation}${tabulation}<RemoveFolder Id="${removeFolderId}" Directory="${directoryId}" On="uninstall"/>\n`
      componentElement += `${currentTabulation}</Component>\n\n`

      const subDirsElements = this.formatWixComponents(
        dir.children,
        null,
        mainExeFileName,
        arch,
        currentTabulation,
        tabulation
      );

      result += componentElement + subDirsElements
    }

    return result;
}

  private generateWixSources(inputPath: string, mainExeFileName: string, arch: Arch): string {
    let wixFragmentBody = '';

    const dirsInfo = this.collectDirs(inputPath, '');
    if (dirsInfo && dirsInfo.children) {
      const tabulation = '    '; // 4 spaces
      const currentTabulation = tabulation + tabulation + tabulation;
      const generatedDirs = this.formatWixDirectories(dirsInfo.children, currentTabulation, tabulation);
      const generatedComponents = this.formatWixComponents(
        dirsInfo,
        'INSTALLDIR',
        mainExeFileName,
        arch,
        currentTabulation,
        tabulation
      );

      wixFragmentBody = `
        <DirectoryRef Id="INSTALLDIR">
            ${generatedDirs.trim()}
        </DirectoryRef>

        <ComponentGroup Id="ApplicationFiles">
            ${generatedComponents.trim()}
        </ComponentGroup>`;
    }

    const wixFragmentTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
    <Fragment>
        ${wixFragmentBody.trim()}
    </Fragment>
</Wix>`;

    return wixFragmentTemplate;
  }
}

interface DirInfo {
  dirname: string,
  dirpath: string,
  children: Array<DirInfo>
}
