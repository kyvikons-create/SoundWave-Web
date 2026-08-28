/* Генерирует TBD-заглушки в формате, который понимает линковщик Zig (!tapi-tbd + tbd-version) */
const fs = require('fs');
const path = require('path');

function tbd(installName, symbols, extra = '') {
  return `--- !tapi-tbd
tbd-version:     4
targets:         [ arm64-ios, arm64-macos ]
install-name:    '${installName}'
${extra}exports:
  - targets:         [ arm64-ios, arm64-macos ]
    symbols:         [ ${symbols.join(', ')} ]
`;
}

const out = {};
out['libobjc.tbd'] = tbd('/usr/lib/libobjc.A.dylib', [
  '_objc_msgSend', '_objc_msgSendSuper2', '_objc_retain', '_objc_release',
  '_objc_storeStrong', '_objc_retainAutoreleasedReturnValue',
  '_objc_autoreleaseReturnValue', '_objc_unsafeClaimAutoreleasedReturnValue',
  '_objc_autoreleasePoolPush', '_objc_autoreleasePoolPop',
  '_objc_alloc', '_objc_allocWithZone', '_objc_alloc_init',
  '_objc_retainBlock', '_objc_destroyWeak', '_objc_initWeak',
  '_objc_loadWeakRetained', '_objc_storeWeak',
  '_objc_opt_class', '_objc_opt_isKindOfClass', '_objc_opt_new',
  '_objc_opt_respondsToSelector', '_objc_terminate', '_objc_enumerationMutation',
  '_objc_setProperty_nonatomic', '_objc_getProperty', '_objc_copyStruct',
  '_objc_getClass', '_sel_registerName', '_objc_copyClassList',
  '__objc_empty_cache', '__objc_empty_vtable'
]);
out['libsystem_blocks.tbd'] = tbd('/usr/lib/system/libsystem_blocks.dylib', [
  '_NSConcreteGlobalBlock', '_NSConcreteStackBlock', '_NSConcreteAutoBlock',
  '_Block_copy', '_Block_release', '_Block_object_assign',
  '_Block_object_dispose', '_Block_byref_refcopy', '_Block_byref_release',
  '__NSConcreteGlobalBlock', '__NSConcreteStackBlock', '__NSConcreteAutoBlock',
  '__Block_copy', '__Block_release', '__Block_object_assign',
  '__Block_object_dispose', '___Block_byref_refcopy', '___Block_byref_release'
]);
out['libdispatch.tbd'] = tbd('/usr/lib/system/libdispatch.dylib', [
  '_dispatch_async', '_dispatch_get_main_queue', '_dispatch_sync'
]);
out['libSystem.tbd'] = tbd('/usr/lib/libSystem.B.dylib', [
  '_malloc', '_free', '_memcpy', '_memset', '_memmove', '_strlen', '_strcmp',
  '___stack_chk_guard', '___stack_chk_fail', '_abort', '_strncmp',
  '___chkstk_darwin', '__dyld_private'
]);
out['CoreFoundation.tbd'] = tbd('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation', [
  '___CFConstantStringClassReference', '_kCFBooleanTrue', '_kCFBooleanFalse'
]);
const classes = names => names.flatMap(n => [`_OBJC_CLASS_$_${n}`, `_OBJC_METACLASS_$_${n}`]);
out['Foundation.tbd'] = tbd('/System/Library/Frameworks/Foundation.framework/Foundation', classes([
  'NSObject', 'NSString', 'NSNumber', 'NSDictionary', 'NSMutableDictionary',
  'NSData', 'NSError', 'NSURL', 'NSMutableURLRequest', 'NSURLSession',
  'NSURLSessionDataTask', 'NSHTTPURLResponse', 'NSURLResponse', 'NSBundle'
]));
out['UIKit.tbd'] = tbd('/System/Library/Frameworks/UIKit.framework/UIKit', [
  '_UIApplicationMain', ...classes(['UIWindow', 'UIScreen', 'UIView', 'UIColor', 'UIViewController'])
]);
out['WebKit.tbd'] = tbd('/System/Library/Frameworks/WebKit.framework/WebKit', classes([
  'WKWebView', 'WKWebViewConfiguration', 'WKUserContentController',
  'WKUserScript', 'WKScriptMessage', 'WKContentWorld'
]));
out['AVFAudio.tbd'] = tbd('/System/Library/Frameworks/AVFAudio.framework/AVFAudio', [
  ...classes(['AVAudioSession']), '_AVAudioSessionCategoryPlayback'
]);

const dir = path.join(__dirname, 'tbd');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
for (const [name, content] of Object.entries(out)) {
  const fname = name.startsWith('lib') ? name : 'lib' + name;
  fs.writeFileSync(path.join(dir, fname), content, 'utf8');
  console.log('tbd/' + fname);
}
