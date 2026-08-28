/* SoundWave — нативная оболочка: WKWebView + сетевой мост к SoundCloud API.
   Всё через objc_msgSend/objc_getClass/sel_registerName — минимум внешних
   символов (обход бага Mach-O линковщика Zig при большом объёме релоцирований).
   Сеть — delegate-стиль NSURLSession: в сетевом пути НИ ОДНОГО блока. */
#import "shim.h"

extern id objc_getClass(const char *name);
extern SEL sel_registerName(const char *str);
extern id objc_msgSend(id, SEL, ...);
static void *SW_SEND;
__attribute__((constructor)) static void sw_send_init(void) { SW_SEND = (void *)objc_msgSend; }

typedef id    (*msid)(id, SEL);
typedef id    (*msid1)(id, SEL, id);
typedef id    (*msidc)(id, SEL, const char *);
typedef id    (*msid2)(id, SEL, id, id);
typedef id    (*msid3)(id, SEL, id, id, id);
typedef void  (*mv1)(id, SEL, id);
typedef void  (*mv2)(id, SEL, id, id);
typedef void  (*mv3)(id, SEL, id, id, id);
typedef void  (*mv0)(id, SEL);
typedef long  (*ml0)(id, SEL);
typedef id    (*mint)(id, SEL, int);
typedef id    (*mdata)(id, SEL, id, unsigned long);
typedef id    (*mif)(id, SEL, id, unsigned long, unsigned char);
typedef id    (*mcgf)(id, SEL, CGRect);
typedef id    (*mcgc)(id, SEL, CGRect, id);
typedef CGRect (*mrect)(id, SEL);
typedef id    (*mdd)(id, SEL, double, double);
typedef _Bool (*mbe2)(id, SEL, id, id *);
typedef _Bool (*mbae)(id, SEL, unsigned char, id *);
typedef void  (*mpsw)(id, SEL, id, id, unsigned char); /* performSelectorOnMainThread: */

#define CLS(n)      ((id)objc_getClass(n))
#define SEL_(n)     sel_registerName(n)
#define S(n)        ((msidc)SW_SEND)((id)CLS("NSString"), SEL_("stringWithUTF8String:"), n)
#define NEW(n)      ((msid)SW_SEND)((id)CLS(n), SEL_("alloc"))

static const char *SW_UA_C =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15"
  " (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

static const char *SW_BRIDGE_JS_C =
"(function(){"
"window.__swSeq=0;window.__swP={};"
"window.__swNativeFetch=function(u){var i=''+(++window.__swSeq);"
"return new Promise(function(res,rej){window.__swP[i]={r:res,j:rej};"
"window.webkit.messageHandlers.sw.postMessage({u:u,i:i});});};"
"window.__swRecv=function(o){var p=window.__swP[o.i];if(!p)return;"
"delete window.__swP[o.i];"
"if(o.err)p.j(new Error(o.err));else p.r({status:o.status,text:o.text});};"
"})();";

static id g_win, g_wv;   /* окно и вебвью */
static id g_sess, g_bridge, g_eval; /* сессия, мост, помощник eval */
static id g_bufs;        /* mid -> NSMutableData */

/* ---------- помощник: выполнить JS в главном потоке (без блоков) ---------- */
@interface SWEval : NSObject
- (void)eval:(id)js;
@end
@implementation SWEval
- (void)eval:(id)js {
    if (g_wv && js) ((mv2)SW_SEND)(g_wv, SEL_("evaluateJavaScript:completionHandler:"), js, (id)0);
}
@end

/* ---------- host-allowlist (M-1): только soundcloud.com / sndcdn.com ----------
   Чистый C, без зависимостей от <string.h> (SDK в Zig-cross недоступен):
   длины и сравнение — ручными циклами. Возвращает _Bool (BOOL из shim.h). */
static BOOL sw_streq_ci(const char *a, const char *b) {
    if (!a || !b) return 0;
    unsigned long i = 0;
    for (;;) {
        char ca = a[i], cb = b[i];
        if (ca >= 'A' && ca <= 'Z') ca += 32;
        if (cb >= 'A' && cb <= 'Z') cb += 32;
        if (ca != cb) return 0;
        if (!ca) return 1;
        i++;
    }
}
static BOOL sw_host_ok(const char *host) {
    if (!host || !*host) return 0;
    const char *sufs[] = { "soundcloud.com", "sndcdn.com" };
    unsigned long hl = 0; while (host[hl]) hl++;
    for (int s = 0; s < 2; s++) {
        const char *su = sufs[s];
        unsigned long sl = 0; while (su[sl]) sl++;
        if (hl < sl) continue;
        const char *tail = host + (hl - sl);
        int match = 1;
        for (unsigned long i = 0; i < sl; i++) {
            char a = tail[i], b = su[i];
            if (a >= 'A' && a <= 'Z') a += 32;   /* su — lowercase литерал */
            if (a != b) { match = 0; break; }
        }
        if (!match) continue;
        if (hl == sl) return 1;            /* exact match */
        if (tail[-1] == '.') return 1;     /* subdomain */
    }
    return 0;
}

/* ---------- сетевой мост: delegate-стиль, без блоков ---------- */
@interface SWBridge : NSObject <WKScriptMessageHandler, NSURLSessionDataDelegate>
- (void)userContentController:(id)uc didReceiveScriptMessage:(id)m;
- (void)URLSession:(id)s dataTask:(id)task didReceiveData:(id)data;
- (void)URLSession:(id)s task:(id)task didCompleteWithError:(id)error;
- (void)finishTask:(id)task error:(id)error;
@end

@implementation SWBridge
- (void)userContentController:(id)uc didReceiveScriptMessage:(id)m {
    if (!g_sess) {
        if (!g_bufs) g_bufs = ((msid)SW_SEND)((id)CLS("NSMutableDictionary"), SEL_("dictionary"));
        id cfg = ((msid)SW_SEND)((id)CLS("NSURLSessionConfiguration"), SEL_("defaultSessionConfiguration"));
        g_sess = ((msid3)SW_SEND)((id)CLS("NSURLSession"), SEL_("sessionWithConfiguration:delegate:delegateQueue:"), cfg, self, (id)0);
    }
    id body = ((msid)SW_SEND)(m, SEL_("body"));
    id u    = body ? ((msid1)SW_SEND)(body, SEL_("objectForKey:"), S("u")) : (id)0;
    id mid  = body ? ((msid1)SW_SEND)(body, SEL_("objectForKey:"), S("i")) : (id)0;
    id url  = u ? ((msid1)SW_SEND)((id)CLS("NSURL"), SEL_("URLWithString:"), u) : (id)0;
    if (!url || !mid || !g_sess) return;

    /* M-1: host-allowlist — только https + хост из *.soundcloud.com|sndcdn.com.
       Scheme/host NSURL получаем raw-objc (scheme/host → UTF8String → C-строка),
       без new typedef'ов: msid возвращает id (pointer), каст к const char* —
       ABI-эквивалентно. err-ответ — зеркало finishTask (NSMutableDictionary →
       NSJSONSerialization → stringByAppendingString → performSelectorOnMainThread). */
    id scheme = ((msid)SW_SEND)(url, SEL_("scheme"));
    id host   = ((msid)SW_SEND)(url, SEL_("host"));
    const char *sch = scheme ? (const char *)((msid)SW_SEND)(scheme, SEL_("UTF8String")) : (const char *)0;
    const char *hst = host   ? (const char *)((msid)SW_SEND)(host,   SEL_("UTF8String")) : (const char *)0;
    if (!sw_streq_ci(sch, "https") || !sw_host_ok(hst)) {
        id out = ((msid)SW_SEND)((id)CLS("NSMutableDictionary"), SEL_("dictionary"));
        ((mv2)SW_SEND)(out, SEL_("setObject:forKey:"), mid, S("i"));
        ((mv2)SW_SEND)(out, SEL_("setObject:forKey:"), S("host"), S("err"));
        id jd = ((msid3)SW_SEND)((id)CLS("NSJSONSerialization"), SEL_("dataWithJSONObject:options:error:"), out, (id)0, (id)0);
        if (jd) {
            id js = ((mdata)SW_SEND)(NEW("NSString"), SEL_("initWithData:encoding:"), jd, 4UL);
            if (js) {
                id full = ((msid1)SW_SEND)(S("window.__swRecv("), SEL_("stringByAppendingString:"), js);
                full = ((msid1)SW_SEND)(full, SEL_("stringByAppendingString:"), S(");"));
                if (!g_eval) g_eval = ((msid)SW_SEND)(NEW("SWEval"), SEL_("init"));
                static id sw_eval_sel;
                if (!sw_eval_sel) sw_eval_sel = (__bridge id)(void *)sel_registerName("eval:");
                ((mpsw)SW_SEND)(g_eval, SEL_("performSelectorOnMainThread:withObject:waitUntilDone:"),
                                sw_eval_sel, full, 0);
            }
        }
        return;
    }

    id req = ((msid1)SW_SEND)((id)CLS("NSMutableURLRequest"), SEL_("requestWithURL:"), url);
    ((mv2)SW_SEND)(req, SEL_("setValue:forHTTPHeaderField:"), S(SW_UA_C), S("User-Agent"));
    id task = ((msid1)SW_SEND)(g_sess, SEL_("dataTaskWithRequest:"), req);
    ((mv1)SW_SEND)(task, SEL_("setTaskDescription:"), mid);
    ((mv0)SW_SEND)(task, SEL_("resume"));
}

- (void)URLSession:(id)s dataTask:(id)task didReceiveData:(id)data {
    id mid = ((msid)SW_SEND)(task, SEL_("taskDescription"));
    if (!mid || !g_bufs) return;
    id buf = ((msid1)SW_SEND)(g_bufs, SEL_("objectForKey:"), mid);
    if (!buf) {
        buf = ((msid)SW_SEND)((id)CLS("NSMutableData"), SEL_("data"));
        ((mv2)SW_SEND)(g_bufs, SEL_("setObject:forKey:"), buf, mid);
    }
    ((mv1)SW_SEND)(buf, SEL_("appendData:"), data);
}

- (void)URLSession:(id)s task:(id)task didCompleteWithError:(id)error {
    [self finishTask:task error:error];
}

- (void)finishTask:(id)task error:(id)error {
    id mid = ((msid)SW_SEND)(task, SEL_("taskDescription"));
    if (!mid) return;
    id buf = g_bufs ? ((msid1)SW_SEND)(g_bufs, SEL_("objectForKey:"), mid) : (id)0;

    id out = ((msid)SW_SEND)((id)CLS("NSMutableDictionary"), SEL_("dictionary"));
    ((mv2)SW_SEND)(out, SEL_("setObject:forKey:"), mid, S("i"));
    if (error) {
        ((mv2)SW_SEND)(out, SEL_("setObject:forKey:"), S("network"), S("err"));
    } else {
        id resp = ((msid)SW_SEND)(task, SEL_("response"));
        long st = resp ? ((ml0)SW_SEND)(resp, SEL_("statusCode")) : 0;
        id num  = ((mint)SW_SEND)((id)CLS("NSNumber"), SEL_("numberWithInt:"), (int)st);
        ((mv2)SW_SEND)(out, SEL_("setObject:forKey:"), num, S("status"));
        if (buf) {
            id s = ((mdata)SW_SEND)(NEW("NSString"), SEL_("initWithData:encoding:"), buf, 4UL);
            if (s) ((mv2)SW_SEND)(out, SEL_("setObject:forKey:"), s, S("text"));
        }
    }
    if (g_bufs) ((mv1)SW_SEND)(g_bufs, SEL_("removeObjectForKey:"), mid);

    id jd = ((msid3)SW_SEND)((id)CLS("NSJSONSerialization"), SEL_("dataWithJSONObject:options:error:"), out, (id)0, (id)0);
    if (!jd) return;
    id js = ((mdata)SW_SEND)(NEW("NSString"), SEL_("initWithData:encoding:"), jd, 4UL);
    if (!js) return;
    id full = ((msid1)SW_SEND)(S("window.__swRecv("), SEL_("stringByAppendingString:"), js);
    full = ((msid1)SW_SEND)(full, SEL_("stringByAppendingString:"), S(");"));
    if (!g_eval) g_eval = ((msid)SW_SEND)(NEW("SWEval"), SEL_("init"));
    static id sw_eval_sel;
    if (!sw_eval_sel) sw_eval_sel = (__bridge id)(void *)sel_registerName("eval:");
    /* главный поток без блоков — через performSelectorOnMainThread */
    ((mpsw)SW_SEND)(g_eval, SEL_("performSelectorOnMainThread:withObject:waitUntilDone:"),
                    sw_eval_sel, full, 0);
}
@end

/* ---------- делегат приложения ---------- */
@interface SWAppDelegate : NSObject <UIApplicationDelegate>
- (BOOL)application:(id)app didFinishLaunchingWithOptions:(id)opts;
@end

@implementation SWAppDelegate
- (BOOL)application:(id)app didFinishLaunchingWithOptions:(id)opts {
    /* аудиосессия «Playback» — фоновое воспроизведение */
    extern NSString *const AVAudioSessionCategoryPlayback;
    id as = ((msid)SW_SEND)((id)CLS("AVAudioSession"), SEL_("sharedInstance"));
    if (as) {
        ((mbe2)SW_SEND)(as, SEL_("setCategory:error:"), AVAudioSessionCategoryPlayback, NULL);
        ((mbae)SW_SEND)(as, SEL_("setActive:error:"), 1, NULL);
    }

    id scr = ((msid)SW_SEND)((id)CLS("UIScreen"), SEL_("mainScreen"));
    CGRect b = ((mrect)SW_SEND)(scr, SEL_("bounds"));
    g_win = ((mcgf)SW_SEND)(NEW("UIWindow"), SEL_("initWithFrame:"), b);

    id rvc = ((msid)SW_SEND)(NEW("UIViewController"), SEL_("init"));
    id rv  = ((msid)SW_SEND)(rvc, SEL_("view"));

    id ucc = ((msid)SW_SEND)(NEW("WKUserContentController"), SEL_("init"));
    if (!g_bridge) g_bridge = ((msid)SW_SEND)(NEW("SWBridge"), SEL_("init"));
    ((mv2)SW_SEND)(ucc, SEL_("addScriptMessageHandler:name:"), g_bridge, S("sw"));
    id js = S(SW_BRIDGE_JS_C);
    id uscr = ((mif)SW_SEND)(NEW("WKUserScript"),
                          SEL_("initWithSource:injectionTime:forMainFrameOnly:"), js, 0UL, 1);
    ((mv1)SW_SEND)(ucc, SEL_("addUserScript:"), uscr);

    id cfg = ((msid)SW_SEND)(NEW("WKWebViewConfiguration"), SEL_("init"));
    ((mv1)SW_SEND)(cfg, SEL_("setUserContentController:"), ucc);

    g_wv = ((mcgc)SW_SEND)(NEW("WKWebView"), SEL_("initWithFrame:configuration:"), b, cfg);
    ((mv1)SW_SEND)(rv, SEL_("addSubview:"), g_wv);
    ((mv1)SW_SEND)(rv, SEL_("setBackgroundColor:"),
                        ((mdd)SW_SEND)((id)CLS("UIColor"), SEL_("colorWithWhite:alpha:"), 0, 1));

    /* загружаем www/index.html из бандла */
    id bundle = ((msid)SW_SEND)((id)CLS("NSBundle"), SEL_("mainBundle"));
    id p = ((msid3)SW_SEND)(bundle, SEL_("pathForResource:ofType:inDirectory:"),
                                 S("index"), S("html"), S("www"));
    if (p) {
        id nu   = ((msid1)SW_SEND)((id)CLS("NSURL"), SEL_("fileURLWithPath:"), p);
        id burl = ((msid)SW_SEND)(bundle, SEL_("bundleURL"));
        if (nu) ((msid2)SW_SEND)(g_wv, SEL_("loadFileURL:allowingReadAccessToURL:"), nu, burl);
    }

    ((mv1)SW_SEND)(g_win, SEL_("setRootViewController:"), rvc);
    ((mv0)SW_SEND)(g_win, SEL_("makeKeyAndVisible"));
    return YES;
}
@end

int main(int argc, char *argv[]) {
    id dname = S("SWAppDelegate");
    return UIApplicationMain(argc, argv, nil, dname);
}
