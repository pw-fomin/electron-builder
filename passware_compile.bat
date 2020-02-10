@echo off

yarn ts-babel test && yarn set-versions && set BABEL_ENV=production && yarn ts-babel packages/*