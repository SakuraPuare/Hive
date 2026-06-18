# React Doctor 配置说明

本项目用 [React Doctor](https://github.com/millionco/react-doctor) 做 React 代码健康检查，已接入 CI（`npm run doctor`，见 `.github/workflows/registry-cicd.yml`）。配置见 `doctor.config.json`，`blocking: "error"` —— 仅在出现 error 级诊断时让 CI 失败。

## 已修复的问题

- **role-has-required-aria-props**（唯一 error）：`location-combobox` 补齐 `aria-controls`。
- **no-react19-deprecated-apis**（49 forwardRef + 3 useContext）：所有 shadcn 组件经 shadcn CLI（new-york 风格）重新生成为 React 19 ref-as-prop；`lib/auth`、`lib/portal-auth`、`lib/locale` 的 `useContext` 改为 `use()`。
- **jsx-no-constructed-context-values**（3）：三个 Context Provider 的 value 用 `useMemo` 缓存。
- **button-has-type**（9）：所有非提交按钮补 `type="button"`。
- **prefer-module-scope-pure-function / static-value**（5）：无状态纯函数与静态数组上提到模块作用域。
- **可访问性**：promo-codes 复选框补 `aria-label`；PortalLayout 关闭遮罩改为 `<button>`。
- **no-danger**（1）：内容已 DOMPurify 净化，就地 `react-doctor-disable-next-line` 并注明。
- **unused-dependency**（10）：移除被统一包 `radix-ui` 取代的 `@radix-ui/react-*` 单包。
- **死代码**：删除未再被引用的 `NodeEditDialog`。

## 经评估后忽略的规则（`ignore.rules`）

下列规则对本项目属于**架构有意选择、库的既定模式、或工具误报**，故在 config 中忽略，并在此存档理由：

### 架构性（本项目场景不适用）
- `nextjs-no-client-side-redirect`：本前端是 **静态导出 SPA**（`next.config.js` 的 `output: 'export'`），无 Next.js 服务端，无法做服务端重定向；基于 RBAC 的客户端 `router.replace` 守卫是唯一可行方案。

### shadcn / 库既定模式
- `only-export-components`：shadcn 组件按官方约定与 `buttonVariants`/`badgeVariants` 等同文件导出；`lib/*-auth` 按约定同文件导出 Provider + hooks。

### 工具误报
- `deslop/unused-dev-dependency`：`openapi-typescript-codegen`、`swagger2openapi` 经 `scripts/gen-api.mjs` 以 `npx` 调用，Knip 静态分析无法识别。
- `deslop/unused-file`：保留的 UI 基础组件（如 `tooltip`）作为组件库备用，非死代码。
- `exhaustive-deps`：现存若干 `useEffect`/`useMemo` 为 mount-only 或防无限循环而有意省略依赖，均已有 `eslint-disable` 注明。

### React Compiler 时代的建议性规则（非 bug，风格取向）
与 ESLint 中 `react-hooks/*` 设为 `warn` 的处理一致，下列为建议而非缺陷，强行重构既有可用代码风险大于收益：
`prefer-useReducer`、`no-giant-component`、`no-derived-state`、`no-cascading-set-state`、`rerender-functional-setstate`、`no-initialize-state`、`no-event-handler`、`no-effect-chain`、`rerender-memo-with-default-value`、`no-pass-data-to-parent`、`no-pass-live-state-to-parent`、`no-prop-callback-in-effect`、`async-await-in-loop`。

> 说明：以上忽略仅针对建议性/不适用规则；所有能捕获真实 bug、安全、可访问性问题的规则保持开启，未来新代码仍会被检查。
