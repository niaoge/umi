import { join, sep } from 'path';
import { readFileSync, existsSync } from 'fs';
import ejs from 'ejs';
import { minify } from 'html-minifier';
import winPath from '../winPath';

export default function(path, service, chunksMap, minifyHTML, isProduction) {
  // Steps:
  //
  // 1. 获取 html (tpl + pages config)
  // 2. 替换
  // 2.1 routerBase + resourceBaseUrl
  // 2.2 js
  // 2.3 css
  // 3. 压缩

  const { config, paths, webpackConfig, libraryName } = service;

  const pageConfig = (config.pages || {})[path] || {};
  const { document, context = {} } = pageConfig;

  const customizedDocPath = document
    ? join(paths.cwd, document)
    : paths.absPageDocumentPath;
  const existsCustomTpl = existsSync(customizedDocPath);
  const docPath = existsCustomTpl
    ? customizedDocPath
    : paths.defaultDocumentPath;
  let tpl = readFileSync(docPath, 'utf-8');

  if (!existsCustomTpl) {
    tpl = service.applyPlugins('modifyDefaultTemplate', {
      initialValue: tpl,
    });
  }

  if (config.exportStatic && !config.exportStatic.htmlSuffix) {
    path = makeSureLastSlash(path);
  }
  context.path = context.path || path;
  let html = ejs.render(tpl, context, {
    _with: false,
    localsName: 'context',
  });

  let pathToStatic = path
    ? new Array(path.slice(1).split(sep).length).join('../')
    : '';
  if (pathToStatic === '') {
    pathToStatic = './';
  }

  const publicPath = makeSureLastSlash(webpackConfig.output.publicPath);
  let publicPathStr;
  if (isPublicPathAbsolute(publicPath)) {
    pathToStatic = publicPath;
    publicPathStr = `'${publicPath}'`;
  } else {
    pathToStatic = addRelativePrefix(winPath(join(pathToStatic, publicPath)));
    publicPathStr = `location.origin + window.routerBase + '${stripFirstSlash(
      publicPath,
    )}'`;
  }
  let dynamicNonRootRouterScript = '';
  let routerBaseStr;
  if (process.env.BASE_URL) {
    //不需要在代码里写死根目录，如之前/app/pages/ 现在去掉app,只需要子/pages/,/app为动态获取，这样，编译出来的文件，只要复制到任何子目录pages/下就可以运行,符合ssr编译,tomcat,jboss可将前端和后端同时发布，免去跨域等麻烦
    routerBaseStr = JSON.stringify(process.env.BASE_URL);
    const routerBaseSlash = process.env.BASE_URL.endsWith('/') ? '' : " + '/'";
    //下面代码兼容之前的配置
    dynamicNonRootRouterScript = `
    if (window.routerBase !== ''){
      var _idxOf_rb = location.pathname.indexOf(window.routerBase);
      if (_idxOf_rb > -1){
        window.routerBase = location.pathname.substr(0,_idxOf_rb) + window.routerBase${routerBaseSlash};
      }
    }
   `.trim();
  } else {
    routerBaseStr = path
      ? `location.pathname.split('/').slice(0, -${path.split('/').length -
          1}).concat('').join('/')`
      : `'/'`;
  }

  let htmlScript = `
<script>
  window.routerBase = ${routerBaseStr};
  ${dynamicNonRootRouterScript}
  window.publicPath = ${publicPathStr};
</script>
    `.trim();
  htmlScript = service.applyPlugins('modifyHTMLScript', {
    initialValue: htmlScript,
  });

  const cssFiles = isProduction
    ? [getChunkFile(`${libraryName}.css`, chunksMap, isProduction)]
    : [];
  const jsFiles = [getChunkFile(`${libraryName}.js`, chunksMap, isProduction)];
  const cssContent = cssFiles
    // umi.css may don't exists
    .filter(file => file)
    .map(
      file =>
        `<link rel="stylesheet" href="${getAssetsPath(file, pathToStatic)}" />`,
    )
    .join('\r\n');
  const jsContent = jsFiles
    .map(file => `<script src="${getAssetsPath(file, pathToStatic)}"></script>`)
    .join('\r\n');

  if (html.indexOf('</head>') > -1) {
    html = html.replace('</head>', `${cssContent}\r\n</head>`);
  } else {
    html = html.replace('</body>', `${cssContent}\r\n</body>`);
  }
  html = html.replace('</body>', `${htmlScript}\r\n${jsContent}\r\n</body>`);

  html = service.applyPlugins('modifyHTML', {
    initialValue: html,
    args: {
      path,
      route: { path }, // Will remove in umi@2.0
    },
  });

  if (minifyHTML) {
    html = minify(html, {
      removeAttributeQuotes: false, // site don't support no quote attributes
      collapseWhitespace: true,
    });
  }

  return html;
}

function getAssetsPath(file, pathToScript) {
  return `${pathToScript}${stripFirstSlash(file)}`.replace(/^\.\/\.\//, './');
}

function getChunkFile(file, chunksMap, isProduction) {
  if (isProduction) {
    return chunksMap[file];
  } else {
    return file;
  }
}

function makeSureLastSlash(str) {
  if (str === '{{ publicPath }}' || str.slice(-1) === '/') {
    return str;
  } else {
    return `${str}/`;
  }
}

function stripFirstSlash(str) {
  return str.replace(/^\//, '');
}

function isPublicPathAbsolute(publicPath) {
  return (
    publicPath.charAt(0) === '/' ||
    publicPath.indexOf('http://') === 0 ||
    publicPath.indexOf('https://') === 0 ||
    /* 变量 */ publicPath === '{{ publicPath }}'
  );
}

function addRelativePrefix(path) {
  if (path.charAt(0) !== '/' && path.charAt(0) !== '.') {
    return `./${path}`;
  } else {
    return path;
  }
}
