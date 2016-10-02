(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var global = Package.meteor.global;
var meteorEnv = Package.meteor.meteorEnv;
var WebApp = Package.webapp.WebApp;
var main = Package.webapp.main;
var WebAppInternals = Package.webapp.WebAppInternals;
var EJSON = Package.ejson.EJSON;
var _ = Package.underscore._;
var MongoInternals = Package.mongo.MongoInternals;
var Mongo = Package.mongo.Mongo;

/* Package-scope variables */
var createBinaries, parseMacDownloadUrl, parseWindowsDownloadUrls, DOWNLOAD_URLS, launchApp, serve, serveDir, serveDownloadUrl, canServeUpdates, UPDATE_FEED_PATH, serveUpdateFeed;

(function(){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// packages/meson_electron/server/createBinaries.js                                                                   //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
var electronPackager = Meteor.wrapAsync(Npm.require("electron-packager"));
var fs = Npm.require('fs');
var mkdirp = Meteor.wrapAsync(Npm.require('mkdirp'));
var path = Npm.require('path');
var proc = Npm.require('child_process');
var dirsum = Meteor.wrapAsync(Npm.require('lucy-dirsum'));
var readFile = Meteor.wrapAsync(fs.readFile);
var writeFile = Meteor.wrapAsync(fs.writeFile);
var stat = Meteor.wrapAsync(fs.stat);
var util = Npm.require('util');
var rimraf = Meteor.wrapAsync(Npm.require('rimraf'));
var ncp = Meteor.wrapAsync(Npm.require('ncp'));

var exec = Meteor.wrapAsync(function(command, options, callback){
  proc.exec(command, options, function(err, stdout, stderr){
    callback(err, {stdout: stdout, stderr: stderr});
  });
});

var exists = function(path) {
  try {
    stat(path);
    return true;
  } catch(e) {
    return false;
  }
};

var projectRoot = function(){
  if (process.platform === "win32"){
    return process.env.METEOR_SHELL_DIR.split(".meteor")[0];
  } else {
    return process.env.PWD;
  }
};

var ELECTRON_VERSION = '0.36.2';

var electronSettings = Meteor.settings.electron || {};

var IS_MAC = (process.platform === 'darwin');

/* Entry Point */
createBinaries = function() {
  var results = {};
  var builds;
  if (electronSettings.builds){
    builds = electronSettings.builds;
  } else {
    //just build for the current platform/architecture
    if (process.platform === "darwin"){
      builds = [{platform: process.platform, arch: process.arch}];
    } else if (process.platform === "win32"){
      //arch detection doesn't always work on windows, and ia32 works everywhere
      builds = [{platform: process.platform, arch: "ia32"}];
    } else {
      console.error('You must specify one or more builds in Meteor.settings.electron.');
      return results;
    }
  }

  if (_.isEmpty(builds)) {
    console.error('No builds available for this platform.');
    return results;
  }

  builds.forEach(function(buildInfo){
    var buildRequired = false;

    var buildDirs = createBuildDirectories(buildInfo);

    /* Write out Electron application files */
    var appVersion = electronSettings.version;
    var appName = electronSettings.name || "electron";
    var appDescription = electronSettings.description;

    var resolvedAppSrcDir;
    if (electronSettings.appSrcDir) {
      resolvedAppSrcDir = path.join(projectRoot(), electronSettings.appSrcDir);
    } else {
      // See http://stackoverflow.com/a/29745318/495611 for how the package asset directory is derived.
      // We can't read this from the project directory like the user-specified app directory since
      // we may be loaded from Atmosphere rather than locally.
      resolvedAppSrcDir = path.join(process.cwd(), 'assets', 'packages', 'meson_electron', 'app');
    }

    // Check if the package.json has changed before copying over the app files, to account for
    // changes made in the app source dir.
    var packagePath = packageJSONPath(resolvedAppSrcDir);
    var packageJSON = Npm.require(packagePath);

    // Fill in missing package.json fields (note: before the comparison).
    // This isn't just a convenience--`Squirrel.Windows` requires the description and version.
    packageJSON = _.defaults(packageJSON, {
      name: appName && appName.toLowerCase().replace(/\s/g, '-'),
      productName: appName,
      description: appDescription,
      version: appVersion
    });
    // Check if the package has changed before we possibly copy over the app source since that will
    // of course sync `package.json`.
    var packageHasChanged = packageJSONHasChanged(packageJSON, buildDirs.app);

    var didOverwriteNodeModules = false;

    if (appHasChanged(resolvedAppSrcDir, buildDirs.working)) {
      buildRequired = true;

      // Copy the app directory over while also pruning old files.
      if (IS_MAC) {
        // Ensure that the app source directory ends in a slash so we copy its contents.
        // Except node_modules from pruning since we prune that below.
        // TODO(wearhere): `rsync` also uses checksums to only copy what's necessary so theoretically we
        // could always `rsync` rather than checking if the directory's changed first.
         exec(util.format('rsync -a --delete --force --filter="P node_modules" "%s" "%s"',
          path.join(resolvedAppSrcDir, '/'), buildDirs.app));
      } else {
        // TODO(wearhere): More efficient sync on Windows (where `rsync` isn't available.)
        rimraf(buildDirs.app);
        mkdirp(buildDirs.app);
        ncp(resolvedAppSrcDir, buildDirs.app);
        didOverwriteNodeModules = true;
      }
    }

    /* Write out the application package.json */
    // Do this after writing out the application files, since that will overwrite `package.json`.
    // This logic is a little bit inefficient: it's not the case that _every_ change to package.json
    // means that we have to reinstall the node modules; and if we overwrote the node modules, we
    // don't necessarily have to rewrite `package.json`. But doing it altogether is simplest.
    if (packageHasChanged || didOverwriteNodeModules) {
      buildRequired = true;

      // For some reason when this file isn't manually removed it fails to be overwritten with an
      // EACCES error.
      rimraf(packageJSONPath(buildDirs.app));
      writeFile(packageJSONPath(buildDirs.app), JSON.stringify(packageJSON));

      exec("npm install && npm prune", {cwd: buildDirs.app});
    }

    /* Write out Electron Settings */
    var settings = _.defaults({}, electronSettings, {
      rootUrl: process.env.ROOT_URL
    });

    var signingIdentity = electronSettings.sign;
    var signingIdentityRequiredAndMissing = false;
    if (canServeUpdates(buildInfo.platform)) {
      // Enable the auto-updater if possible.
      if ((buildInfo.platform === 'darwin') && !signingIdentity) {
        // If the app isn't signed and we try to use the auto-updater, it will
        // throw an exception. Log an error if the settings have changed, below.
        signingIdentityRequiredAndMissing = true;
      } else {
        settings.updateFeedUrl = settings.rootUrl + UPDATE_FEED_PATH;
      }
    }

    if (settingsHaveChanged(settings, buildDirs.app)) {
      if (signingIdentityRequiredAndMissing) {
        console.error('Developer ID signing identity is missing: remote updates will not work.');
      }
      buildRequired = true;
      writeFile(settingsPath(buildDirs.app), JSON.stringify(settings));
    }

    var packagerSettings = getPackagerSettings(buildInfo, buildDirs);
    if (packagerSettings.icon && iconHasChanged(packagerSettings.icon, buildDirs.working)) {
      buildRequired = true;
    }

    // TODO(wearhere): If/when the signing identity expires, does its name change? If not, we'll need
    // to force the app to be rebuilt somehow.

    if (packagerSettingsHaveChanged(packagerSettings, buildDirs.working)) {
      buildRequired = true;
    }

    var app = appPath(appName, buildInfo.platform, buildInfo.arch, buildDirs.build);
    if (!exists(app)) {
      buildRequired = true;
    }

    /* Create Build */
    if (buildRequired) {
      var build = electronPackager(packagerSettings)[0];
      console.log("Build created for ", buildInfo.platform, buildInfo.arch, "at", build);
    }

    /* Package the build for download if specified. */
    // TODO(rissem): make this platform independent

    if (electronSettings.autoPackage && (buildInfo.platform === 'darwin')) {
      // The auto-updater framework only supports installing ZIP releases:
      // https://github.com/Squirrel/Squirrel.Mac#update-json-format
      var downloadName = (appName || "app") + ".zip";
      var compressedDownload = path.join(buildDirs.final, downloadName);

      if (buildRequired || !exists(compressedDownload)) {
        // Use `ditto` to ZIP the app because I couldn't find a good npm module to do it and also that's
        // what a couple of other related projects do:
        // - https://github.com/Squirrel/Squirrel.Mac/blob/8caa2fa2007b29a253f7f5be8fc9f36ace6aa30e/Squirrel/SQRLZipArchiver.h#L24
        // - https://github.com/jenslind/electron-release/blob/4a2a701c18664ec668c3570c3907c0fee72f5e2a/index.js#L109
        exec('ditto -ck --sequesterRsrc --keepParent "' + app + '" "' + compressedDownload + '"');
        console.log("Downloadable created at", compressedDownload);
      }
    }

    results[buildInfo.platform + "-" + buildInfo.arch] = {
      app: app,
      buildRequired: buildRequired
    };
  });

  return results;
};

function createBuildDirectories(build){
  // Use a predictable directory so that other scripts can locate the builds, also so that the builds
  // may be cached:

  var workingDir = path.join(projectRoot(), '.meteor-electron', build.platform + "-" + build.arch);
  mkdirp(workingDir);

  //TODO consider seeding the binaryDir from package assets so package
  //could work without an internet connection

  // *binaryDir* holds the vanilla electron apps
  var binaryDir = path.join(workingDir, "releases");
  mkdirp(binaryDir);

  // *appDir* holds the electron application that points to a meteor app
  var appDir = path.join(workingDir, "apps");
  mkdirp(appDir);

  // *buildDir* contains the uncompressed apps
  var buildDir = path.join(workingDir, "builds");
  mkdirp(buildDir);

  // *finalDir* contains zipped apps ready to be downloaded
  var finalDir = path.join(workingDir, "final");
  mkdirp(finalDir);

  return {
    working: workingDir,
    binary: binaryDir,
    app: appDir,
    build: buildDir,
    final: finalDir
  };
}

function getPackagerSettings(buildInfo, dirs){
  var packagerSettings = {
    dir: dirs.app,
    name: electronSettings.name || "Electron",
    platform: buildInfo.platform,
    arch: buildInfo.arch,
    version: ELECTRON_VERSION,
    out: dirs.build,
    cache: dirs.binary,
    overwrite: true,
    // The EXE's `ProductName` is the preferred title of application shortcuts created by `Squirrel.Windows`.
    // If we don't set it, it will default to "Electron".
    'version-string': {
      ProductName: electronSettings.name || 'Electron'
    }
  };

  if (electronSettings.version) {
    packagerSettings['app-version'] = electronSettings.version;
  }
  if (electronSettings.icon) {
    var icon = electronSettings.icon[buildInfo.platform];
    if (icon) {
      var iconPath = path.join(projectRoot(), icon);
      packagerSettings.icon = iconPath;
    }
  }
  if (electronSettings.sign) {
    packagerSettings.sign = electronSettings.sign;
  }
  if (electronSettings.protocols) {
    packagerSettings.protocols = electronSettings.protocols;
  }
  return packagerSettings;
}

function settingsPath(appDir) {
  return path.join(appDir, 'electronSettings.json');
}

function settingsHaveChanged(settings, appDir) {
  var electronSettingsPath = settingsPath(appDir);
  var existingElectronSettings;
  try {
    existingElectronSettings = Npm.require(electronSettingsPath);
  } catch(e) {
    // No existing settings.
  }
  return !existingElectronSettings || !_.isEqual(settings, existingElectronSettings);
}

function appHasChanged(appSrcDir, workingDir) {
  var appChecksumPath = path.join(workingDir, 'appChecksum.txt');
  var existingAppChecksum;
  try {
    existingAppChecksum = readFile(appChecksumPath, 'utf8');
  } catch(e) {
    // No existing checksum.
  }

  var appChecksum = dirsum(appSrcDir);
  if (appChecksum !== existingAppChecksum) {
    writeFile(appChecksumPath, appChecksum);
    return true;
  } else {
    return false;
  }
}

function packageJSONPath(appDir) {
  return path.join(appDir, 'package.json');
}

function packageJSONHasChanged(packageJSON, appDir) {
  var packagePath = packageJSONPath(appDir);
  var existingPackageJSON;
  try {
    existingPackageJSON = Npm.require(packagePath);
  } catch(e) {
    // No existing package.
  }

  return !existingPackageJSON || !_.isEqual(packageJSON, existingPackageJSON);
}

function packagerSettingsHaveChanged(settings, workingDir) {
  var settingsPath = path.join(workingDir, 'lastUsedPackagerSettings.json');
  var existingPackagerSettings;
  try {
    existingPackagerSettings = Npm.require(settingsPath);
  } catch(e) {
    // No existing settings.
  }

  if (!existingPackagerSettings || !_.isEqual(settings, existingPackagerSettings)) {
    writeFile(settingsPath, JSON.stringify(settings));
    return true;
  } else {
    return false;
  }
}

function iconHasChanged(iconPath, workingDir) {
  var iconChecksumPath = path.join(workingDir, 'iconChecksum.txt');
  var existingIconChecksum;
  try {
    existingIconChecksum = readFile(iconChecksumPath, 'utf8');
  } catch(e) {
    // No existing checksum.
  }

  // `dirsum` works for files too.
  var iconChecksum = dirsum(iconPath);
  if (iconChecksum !== existingIconChecksum) {
    writeFile(iconChecksumPath, iconChecksum);
    return true;
  } else {
    return false;
  }
}

function appPath(appName, platform, arch, buildDir) {
  var appExtension = (platform === 'darwin') ? '.app' : '.exe';
  return path.join(buildDir, [appName, platform, arch].join('-'), appName + appExtension);
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function(){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// packages/meson_electron/server/downloadUrls.js                                                                     //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
var urlJoin = Npm.require('url-join');

// Global for tests.
parseMacDownloadUrl = function(electronSettings) {
  if (!electronSettings || !electronSettings.downloadUrls || !electronSettings.downloadUrls.darwin) return;

  return electronSettings.downloadUrls.darwin.replace('{{version}}', electronSettings.version);
};

// Global for tests.
parseWindowsDownloadUrls = function(electronSettings) {
  if (!electronSettings || !electronSettings.downloadUrls || !electronSettings.downloadUrls.win32) return;

  // The default value here is what `createBinaries` writes into the app's package.json, which is
  // what is read by `grunt-electron-installer` to name the installer.
  var appName = electronSettings.name || 'electron';

  var releasesUrl, installerUrl;
  var installerUrlIsVersioned = false;

  if (_.isString(electronSettings.downloadUrls.win32)) {
    if (electronSettings.downloadUrls.win32.indexOf('{{version}}') > -1) {
      console.error('Only the Windows installer URL may be versioned. Specify `downloadUrls.win32.installer`.');
      return;
    }
    releasesUrl = electronSettings.downloadUrls.win32;
    // 'AppSetup.exe' refers to the output of `grunt-electron-installer`.
    installerUrl = urlJoin(electronSettings.downloadUrls.win32, appName + 'Setup.exe');
  } else {
    releasesUrl = electronSettings.downloadUrls.win32.releases;
    if (releasesUrl.indexOf('{{version}}') > -1) {
      console.error('Only the Windows installer URL may be versioned.');
      return;
    }
    installerUrl = electronSettings.downloadUrls.win32.installer;
    if (installerUrl.indexOf('{{version}}') > -1) {
      installerUrl = installerUrl.replace('{{version}}', electronSettings.version);
      installerUrlIsVersioned = true;
    }
  }

  // Cachebust the installer URL if it's not versioned.
  // (The releases URL will also be cachebusted, but by `serveUpdateFeed` since we've got to append
  // the particular paths requested by the client).
  if (!installerUrlIsVersioned) {
    installerUrl = cachebustedUrl(installerUrl);
  }

  return {
    releases: releasesUrl,
    installer: installerUrl
  };
};

function cachebustedUrl(url) {
  var querySeparator = (url.indexOf('?') > -1) ? '&' : '?';
  return url + querySeparator + 'cb=' + Date.now();
}

DOWNLOAD_URLS = {
  darwin: parseMacDownloadUrl(Meteor.settings.electron),
  win32: parseWindowsDownloadUrls(Meteor.settings.electron)
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function(){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// packages/meson_electron/server/launchApp.js                                                                        //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
var isRunning = Meteor.wrapAsync(Npm.require("is-running"));
var path = Npm.require('path');
var proc = Npm.require('child_process');

var ElectronProcesses = new Mongo.Collection("processes");

var ProcessManager = {
  add: function(pid){
    ElectronProcesses.insert({ pid: pid });
  },

  running: function(){
    var runningProcess;
    ElectronProcesses.find().forEach(function(proc){
      if (isRunning(proc.pid)){
        runningProcess = proc.pid;
      } else {
        ElectronProcesses.remove({ _id: proc._id });
      }
    });
    return runningProcess;
  },

  stop: function(pid) {
    process.kill(pid);
    ElectronProcesses.remove({ pid: pid });
  }
};

launchApp = function(app, appIsNew) {
  // Safeguard.
  if (process.env.NODE_ENV !== 'development') return;

  var runningProcess = ProcessManager.running();
  if (runningProcess) {
    if (!appIsNew) {
      return;
    } else {
      ProcessManager.stop(runningProcess);
    }
  }

  var electronExecutable, child;
  if (process.platform === 'win32') {
    electronExecutable = app;
    child = proc.spawn(electronExecutable);
  } else {
    electronExecutable = path.join(app, "Contents", "MacOS", "Electron");
    var appDir = path.join(app, "Contents", "Resources", "app");

    //TODO figure out how to handle case where electron executable or
    //app dir don't exist

    child = proc.spawn(electronExecutable, [appDir]);
  }

  child.stdout.on("data", function(data){
    console.log("ATOM:", data.toString());
  });

  child.stderr.on("data", function(data){
    console.log("ATOM:", data.toString());
  });

  ProcessManager.add(child.pid);
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function(){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// packages/meson_electron/server/serve.js                                                                            //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
serve = function(path, handler) {
  if (Package["iron:router"]){
    Package["iron:router"].Router.route(path, function(){
      handler(this.request, this.response, this.next);
    }, {where: "server"});
  } else {
    WebApp.rawConnectHandlers.use(function(req, res, next){
      if (req.path === path) {
        handler(req, res, next);
      } else {
        next();
      }
    });
  }
};

serveDir = function(dir, handler){
  //path starts with dir
  if (Package["iron:router"]){
    Package["iron:router"].Router.route(dir + "/:stuff", function(){
      handler(this.request, this.response, this.next);
    }, {where: "server"});
  } else {
    var regex = new RegExp("^" + dir);
    WebApp.rawConnectHandlers.use(function(req, res, next){
      if (regex.test(req.path)) {
        handler(req, res, next);
      } else {
        next();
      }
    });
  }
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function(){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// packages/meson_electron/server/serveDownloadUrl.js                                                                 //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
serveDownloadUrl = function() {
  serve('/app/download', function(req, res, next) {
    var installerUrl = DOWNLOAD_URLS[req.query.platform];
    if (_.isObject(installerUrl)) {
      installerUrl = installerUrl.installer;
    }
    if (installerUrl) {
      res.statusCode = 302; // Moved Temporarily
      res.setHeader('Location', installerUrl);
      res.end();
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function(){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// packages/meson_electron/server/serveUpdateFeed.js                                                                  //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
var semver = Npm.require('semver');
var urlJoin = Npm.require('url-join');
var electronSettings = Meteor.settings.electron || {};
var latestVersion = electronSettings.version;

canServeUpdates = function(platform) {
  if (!latestVersion){
    return false;
  }

  return !!DOWNLOAD_URLS[platform];
};

UPDATE_FEED_PATH = "/app/latest";

serveUpdateFeed = function() {
  // https://github.com/Squirrel/Squirrel.Mac#server-support
  if (canServeUpdates("darwin")){
    serve(UPDATE_FEED_PATH, function(req, res, next) {
      var appVersion = req.query.version;
      if (semver.valid(appVersion) && semver.gte(appVersion, latestVersion)) {
        res.statusCode = 204; // No content.
        res.end();
      } else {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          url: DOWNLOAD_URLS['darwin']
        }));
      }
    });
  }

  // https://github.com/squirrel/squirrel.windows
  // (Summary 'cause those docs are scant: the Windows app is going to expect the update feed URL
  // to represent a directory from within which it can fetch the RELEASES file and packages. The
  // above `serve` call serves _just_ '/app/latest', whereas this serves its contents.)
  if (canServeUpdates("win32")) {
    // `path.dirname` works even on Windows.
    var releasesUrl = DOWNLOAD_URLS['win32'].releases;
    serveDir(UPDATE_FEED_PATH, function(req, res, next){
      //first strip off the UPDATE_FEED_PATH
      var path = req.url.split(UPDATE_FEED_PATH)[1];
      res.statusCode = 302;
      // Cache-bust the RELEASES file.
      if (/RELEASES/.test(path)) {
        path += (/\?/.test(path) ? '&' : '?') + 'cb=' + Date.now();
      }
      res.setHeader("Location", urlJoin(releasesUrl, path));
      res.end();
    });
  }
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function(){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// packages/meson_electron/server/index.js                                                                            //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
var electronSettings = Meteor.settings.electron || {};

if ((process.env.NODE_ENV === 'development') && (electronSettings.autoBuild !== false)) {
  var buildResults = createBinaries();
  var buildResultForThisPlatform = buildResults[process.platform + '-' + process.arch];
  if (buildResultForThisPlatform) {
    launchApp(buildResultForThisPlatform.app, buildResultForThisPlatform.buildRequired);
  }
}

serveDownloadUrl();
serveUpdateFeed();

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);


/* Exports */
if (typeof Package === 'undefined') Package = {};
(function (pkg, symbols) {
  for (var s in symbols)
    (s in pkg) || (pkg[s] = symbols[s]);
})(Package['meson:electron'] = {}, {
  parseMacDownloadUrl: parseMacDownloadUrl,
  parseWindowsDownloadUrls: parseWindowsDownloadUrls
});

})();

//# sourceMappingURL=meson_electron.js.map
