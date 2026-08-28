/* Мини-заголовки системных классов iOS — компилируем без SDK */
#pragma once

typedef long NSInteger;
typedef unsigned long NSUInteger;
typedef _Bool BOOL;
#ifndef YES
#define YES ((BOOL)1)
#define NO  ((BOOL)0)
#endif
#ifndef NULL
#define NULL ((void *)0)
#endif
#ifndef nil
#define nil ((id)0)
#define Nil ((Class)0)
#endif

typedef struct { double x, y; } CGPoint;
typedef struct { double width, height; } CGSize;
typedef struct { CGPoint origin; CGSize size; } CGRect;

typedef void (^dispatch_block_t)(void);
extern void *dispatch_get_main_queue(void);
extern void dispatch_async(void *queue, dispatch_block_t block);

/* протоколы (пустые — селекторы проверяются в рантайме) */
@protocol UIApplicationDelegate @end
@protocol WKScriptMessageHandler
- (void)userContentController:(id)uc didReceiveScriptMessage:(id)message;
@end
@protocol NSURLSessionDataDelegate @end

@interface NSObject { Class isa; }
- (id)init;
+ (id)alloc;
+ (id)new;
@end

@interface NSString : NSObject
+ (id)stringWithUTF8String:(const char *)s;
- (const char *)UTF8String;
- (id)stringByAppendingString:(id)s;
- (id)initWithData:(id)data encoding:(NSUInteger)enc;
@end

@interface NSNumber : NSObject
+ (id)numberWithInt:(int)v;
+ (id)numberWithBool:(BOOL)v;
@end

@interface NSDictionary : NSObject
- (id)objectForKey:(id)key;
@end

@interface NSMutableDictionary : NSDictionary
+ (id)dictionary;
- (void)setObject:(id)obj forKey:(id)key;
@end

@interface NSData : NSObject @end
@interface NSMutableData : NSData
+ (id)data;
- (void)appendData:(id)d;
@end
@interface NSURLSessionConfiguration : NSObject
+ (id)defaultSessionConfiguration;
@end
@interface NSError : NSObject
- (id)localizedDescription;
+ (id)errorWithDomain:(id)domain code:(NSInteger)code userInfo:(id)ui;
@end

@interface NSURL : NSObject
+ (id)URLWithString:(id)s;
+ (id)fileURLWithPath:(id)p;
@end

@interface NSMutableURLRequest : NSObject
+ (id)requestWithURL:(id)url;
- (void)setValue:(id)v forHTTPHeaderField:(id)f;
@end

@interface NSURLResponse : NSObject @end

@interface NSURLSession : NSObject
+ (id)sharedSession;
+ (id)sessionWithConfiguration:(id)c delegate:(id)d delegateQueue:(id)q;
- (id)dataTaskWithRequest:(id)req;
- (id)dataTaskWithRequest:(id)req completionHandler:(void (^)(id data, NSURLResponse *response, NSError *error))handler;
@end

@interface NSURLSessionDataTask : NSObject
- (void)resume;
@end

@interface NSHTTPURLResponse : NSObject
- (NSInteger)statusCode;
@end

@interface NSBundle : NSObject
+ (id)mainBundle;
- (id)pathForResource:(id)name ofType:(id)ext inDirectory:(id)dir;
- (id)bundleURL;
@end

@interface UIColor : NSObject
+ (id)colorWithWhite:(double)w alpha:(double)a;
@end

@interface UIScreen : NSObject
+ (id)mainScreen;
- (CGRect)bounds;
@end

@interface UIView : NSObject
- (id)initWithFrame:(CGRect)f;
- (CGRect)bounds;
- (void)addSubview:(id)v;
- (void)setBackgroundColor:(id)c;
@end

@interface UIWindow : UIView
- (void)setRootViewController:(id)vc;
- (void)makeKeyAndVisible;
@end

@interface UIViewController : NSObject
- (id)init;
- (id)view;
@end

@interface WKWebView : UIView
- (id)initWithFrame:(CGRect)f configuration:(id)c;
- (id)loadFileURL:(id)url allowingReadAccessToURL:(id)acc;
@end

@interface WKWebViewConfiguration : NSObject
- (id)userContentController;
- (void)setUserContentController:(id)ucc;
@end

@interface WKUserContentController : NSObject
- (void)addScriptMessageHandlerWithReply:(id)handler contentWorld:(id)world name:(id)name;
- (void)addUserScript:(id)script;
@end

@interface WKUserScript : NSObject
- (id)initWithSource:(id)src injectionTime:(NSUInteger)t forMainFrameOnly:(BOOL)mainOnly;
@end

@interface WKScriptMessage : NSObject
- (id)body;
@end

@interface WKContentWorld : NSObject
+ (id)pageContentWorld;
@end

@interface AVAudioSession : NSObject
+ (id)sharedInstance;
- (BOOL)setCategory:(id)cat error:(id *)err;
- (BOOL)setActive:(BOOL)a error:(id *)err;
@end
extern NSString *const AVAudioSessionCategoryPlayback;

extern int UIApplicationMain(int argc, char *argv[], id principalClassName, id delegateClassName);
