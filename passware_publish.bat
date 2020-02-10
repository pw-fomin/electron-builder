@echo off

for %%a in (electron-updater, electron-builder, app-builder-lib) do (
    npm publish packages/%%a --registry=https://nexus.dotcomltd.ru/repository/npm/
)