module.exports = {
    ENTITY_FORMATS: {
        linkedin: 'linkedin.com/company/',
        facebook: 'facebook.com/',
        twitter: 'twitter.com/',
        instagram: 'instagram.com/',
        youtube: 'youtube.com/channel/',
        youtube_user: 'youtube.com/user/',
        snapchat: 'snapchat.com/',
        github: 'github.com/',
        play_store: 'play.google.com/store/',
        apple_store: 'apps.apple.com/',
        app_store: 'itunes.apple.com/'
    },
    ENTITY_REGEX: {
        linkedin: ['linkedin', 'Linkedin'],
        facebook: ['facebook', 'Facebook', 'fb', 'FB'],
        twitter: ['twitter', 'Twitter'],
        instagram: ['instagram', 'Instagram'],
        youtube: ['youtube', 'Youtube'],
        youtube_user: ['youtube', 'Youtube'],
        snapchat: ['snapchat', 'Snapchat'],
        github: ['github', 'Github', 'Git', 'git', 'repo'],
        play_store: ['play', 'Play', 'android', 'Android'],
        app_store: ['app', 'App', 'apple', 'Apple', 'iOS', 'ios', 'IOS'],
        apple_store: ['app', 'App', 'apple', 'Apple', 'iOS', 'ios', 'IOS']
    },
    ENTITY_EXCLUSION: [
        'linkedin.com/shareArticle?',
        'facebook.com/sharer',
        'facebook.com/share.php?',
        'facebook.com/login',
        'facebook.com/hashtag/',
        'twitter.com/intent/',
        'twitter.com/hashtag/',
        'twitter.com/login',
        'help.twitter.com',
        'support.twitter.com',
        'instagram.com/accounts/',
        'instagram.com/share?',
        'instagram.com/sharer',
        'instagram.com/v/',
        'instagram.com/legal/',
        'instagram.com/s/',
        'instagram.com/p/',
        'instagram.com/tv/',
        'twitter.com/share?',
        'plus.google.com/share?',
        'facebook.com/policies',
        'facebook.com/l.php?',
        'mailto:',
        'facebook.com/policy',
        'instagram.com/explore/',
        'twitter.com/i/',
        'twitter.com/home/',
        'twitter.com/home?',
        'twitter.com/search?',
        'twitter.com/#',
        'facebook.com/dialog/',
        'facebook.com/events/',
        'facebook.com/about/',
        'facebook.com/groups/',
        'facebook.com/docs/'
    ],
    MAX_URLS_ALLOWED: 20,
    PROTOCOLS: ['https://', 'http://', 'www.'],
    USER_AGENT: 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.0 Safari/537.36',
    LEVEL_LIMIT: 2
}