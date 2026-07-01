import { Html, Head, Main, NextScript } from 'next/document';

/**
 * 防主题色闪烁(FOUC)。next-themes 已负责在 <html> 挂 .dark class;这里补一段
 * 阻塞脚本,在首帧绘制前从 localStorage 读回用户选的主题色 key 并写到
 * <html data-theme-color>,让 styles/themes.css 的角色覆写立即生效 —— 避免
 * 先闪一下默认 Google 蓝再跳到用户色。key 与 lib/theme-color.tsx 的常量一致。
 *
 * 脚本内联、无依赖、幂等;非法/缺省值不写属性(回落 globals.css 默认色)。
 */
const THEME_COLOR_INIT = `(function(){try{var k=localStorage.getItem('hive_theme_color');var ok=['red','pink','purple','deep-purple','indigo','blue','light-blue','cyan','teal','green','light-green','lime','yellow','amber','orange','deep-orange','brown','grey','blue-grey'];if(k&&ok.indexOf(k)!==-1){document.documentElement.setAttribute('data-theme-color',k);}}catch(e){}})();`;

export default function Document() {
  return (
    <Html>
      <Head />
      <body>
        {/* Inline blocking script: anti-FOUC theme-color init before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_COLOR_INIT }} />
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
