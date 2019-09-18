import * as HTMLUtilities from "../utils/HTMLUtilities";
import Annotator, { AnnotationType } from "../store/Annotator";
import IFrameNavigator, { ReaderRights } from "../navigator/IFrameNavigator";
import Publication, { Link } from "../model/Publication";
import ReaderModule from "./ReaderModule";
import { addEventListenerOptional } from "../utils/EventHandler";
import { icons as IconLib } from "../utils/IconLib";
import { Bookmark, Locator } from "../model/Locator";
import { IS_DEV } from "..";
import { toast } from "materialize-css";
import { UserSettings } from "../model/user-settings/UserSettings";

export type AddBookmark = (bookmark: Bookmark) => Promise<Bookmark>
export type DeleteBookmark = (bookmark: Bookmark) => Promise<Bookmark>

export interface BookmarkModuleAPI {
    addBookmark: AddBookmark;
    deleteBookmark: DeleteBookmark;
}

export interface BookmarkModuleConfig {
    annotator: Annotator;
    headerMenu: HTMLElement;
    rights: ReaderRights;
    publication: Publication;
    settings: UserSettings;
    delegate: IFrameNavigator;
    initialAnnotations?: any;
}

export default class BookmarkModule implements ReaderModule {

    api: BookmarkModuleAPI;
    annotator: Annotator | null;
    rights: ReaderRights;

    private publication: Publication;
    private settings: UserSettings;

    private bookmarksView: HTMLDivElement;
    private sideNavSectionBookmarks: HTMLElement;

    private headerMenu: HTMLElement;

    private initialAnnotations: any;

    delegate: IFrameNavigator

    public static async create(config: BookmarkModuleConfig): Promise<any> {
        const module = new this(
            config.annotator,
            config.headerMenu,
            config.rights || { enableBookmarks: false },
            config.publication,
            config.settings,
            config.delegate,
            config.initialAnnotations || null,
        );
        await module.start();
        return new Promise(resolve => resolve(module));
    }


    public constructor(annotator: Annotator, headerMenu: HTMLElement, rights: ReaderRights,
        publication: Publication, settings: UserSettings, delegate: IFrameNavigator, initialAnnotations: any | null = null
    ) {

        this.annotator = annotator
        this.rights = rights
        this.publication = publication
        this.settings = settings
        this.headerMenu = headerMenu
        this.delegate = delegate
        this.initialAnnotations = initialAnnotations;
        this.api = this.delegate.api
    }

    async stop() {

        if (IS_DEV) { console.log("Bookmark module stop") }

    }

    protected async start(): Promise<void> {

        this.delegate.bookmarkModule = this

        if (this.headerMenu) this.bookmarksView = HTMLUtilities.findElement(this.headerMenu, "#container-view-bookmarks") as HTMLDivElement;

        if (this.headerMenu) this.sideNavSectionBookmarks = HTMLUtilities.findElement(this.headerMenu, "#sidenav-section-bookmarks") as HTMLElement;

        if (this.headerMenu) {
            var menuBookmark = HTMLUtilities.findElement(this.headerMenu, "#menu-button-bookmark") as HTMLLinkElement;
            if (this.rights.enableBookmarks) {
                menuBookmark.parentElement.style.display = "unset";
                addEventListenerOptional(menuBookmark, 'click', this.saveBookmark.bind(this));
            } else {
                menuBookmark.parentElement.style.display = "none";
                this.sideNavSectionBookmarks.style.display = "none";
            }
        }

        if (this.initialAnnotations) {
            var bookmarks = this.initialAnnotations['bookmarks'] || null;
            if (bookmarks) {
                this.annotator.initBookmarks(bookmarks)
            }
        }

        this.showBookmarks();


    }

    async deleteBookmark(bookmark: Bookmark): Promise<any> {
        if (this.annotator) {
            if (this.api.deleteBookmark) {
                this.api.deleteBookmark(bookmark).then(async _result => {
                    var deleted = await this.annotator.deleteBookmark(bookmark);

                    if (IS_DEV) { console.log("Bookmark deleted " + JSON.stringify(deleted)); }
                    await this.showBookmarks();
                    if (this.delegate.material) {
                        toast({ html: 'bookmark deleted' })
                    }
                    return deleted
                })
            } else {
                var deleted = await this.annotator.deleteBookmark(bookmark);

                if (IS_DEV) { console.log("Bookmark deleted " + JSON.stringify(deleted)); }
                await this.showBookmarks();
                if (this.delegate.material) {
                    toast({ html: 'bookmark deleted' })
                }
                return deleted
            }
        } else {
            return new Promise<any>(resolve => resolve());
        }
    }

    async saveBookmark(): Promise<any> {
        if (this.annotator) {

            var tocItem = this.publication.getTOCItem(this.delegate.currentChapterLink.href);
            if (this.delegate.currentTocUrl !== null) {
                tocItem = this.publication.getTOCItem(this.delegate.currentTocUrl);
            }

            if (tocItem === null) {
                tocItem = this.publication.getTOCItemAbsolute(this.delegate.currentChapterLink.href);
            }

            const url = this.publication.getAbsoluteHref(tocItem.href);

            const bookmarkPosition = this.settings.getSelectedView().getCurrentPosition();


            const bookmark: Bookmark = {
                href: url,
                locations: {
                    progression: bookmarkPosition
                },
                created: new Date(),
                type: this.delegate.currentChapterLink.type,
                title: this.delegate.currentChapterLink.title
            }

            if (!await this.annotator.locatorExists(bookmark, AnnotationType.Bookmark)) {
                if (this.api.addBookmark) {
                    this.api.addBookmark(bookmark).then(async bookmark => {
                        console.log(bookmark)
                        var saved = await this.annotator.saveBookmark(bookmark);

                        if (IS_DEV) { console.log("Bookmark added " + JSON.stringify(saved)); }
                        if (this.delegate.material) {
                            toast({ html: 'bookmark added' })
                        }
                        await this.showBookmarks();
                        return saved
                    })
                } else {
                    var saved = await this.annotator.saveBookmark(bookmark);

                    if (IS_DEV) { console.log("Bookmark added " + JSON.stringify(saved)); }
                    if (this.delegate.material) {
                        toast({ html: 'bookmark added' })
                    }
                    await this.showBookmarks();
                    return saved
                }

            } else {
                if (this.delegate.material) {
                    toast({ html: 'bookmark exists' })
                }
            }

        } else {
            return new Promise<any>(resolve => resolve());
        }
    }

    public async showBookmarks(): Promise<void> {
        let bookmarks: Array<any> = [];
        if (this.annotator) {
            bookmarks = await this.annotator.getBookmarks() as Array<any>;
        }

        if (this.bookmarksView) this.createTree(AnnotationType.Bookmark, bookmarks, this.bookmarksView)
    }

    private createTree(type: AnnotationType, annotations: Array<any>, view: HTMLDivElement) {
        if (annotations) {
            const self = this;
            const toc = this.publication.readingOrder;
            if (toc.length) {
                const createAnnotationTree = (parentElement: Element, links: Array<Link>) => {
                    let chapterList: HTMLUListElement = document.createElement("ul");
                    chapterList.className = 'sidenav-annotations';
                    for (const link of links) {
                        let chapterHeader: HTMLLIElement = document.createElement("li");
                        const linkElement: HTMLAnchorElement = document.createElement("a");
                        const spanElement: HTMLSpanElement = document.createElement("span");
                        linkElement.tabIndex = -1;
                        linkElement.className = "chapter-link"
                        if (link.href) {
                            const linkHref = this.publication.getAbsoluteHref(link.href);
                            const tocItemAbs = this.publication.getTOCItemAbsolute(linkHref);
                            linkElement.href = linkHref;
                            linkElement.innerHTML = tocItemAbs.title || "";
                            chapterHeader.appendChild(linkElement);
                        } else {
                            spanElement.innerHTML = link.title || "";
                            spanElement.className = "chapter-title"
                            chapterHeader.appendChild(spanElement);
                        }

                        addEventListenerOptional(linkElement, 'click', (event: MouseEvent) => {
                            event.preventDefault();
                            event.stopPropagation();

                            const position: Locator = {
                                href: linkElement.href,
                                locations: {
                                    progression: 0
                                },
                                type: link.type,
                                title: linkElement.title
                            };

                            this.delegate.navigate(position);
                        });

                        const bookmarkList: HTMLUListElement = document.createElement("ol");
                        annotations.forEach(function (locator: any) {

                            const href = (link.href.indexOf("#") !== -1) ? link.href.slice(0, link.href.indexOf("#")) : link.href

                            if (link.href && locator.href.endsWith(href)) {
                                let bookmarkItem: HTMLLIElement = document.createElement("li");
                                bookmarkItem.className = "annotation-item"
                                let bookmarkLink: HTMLAnchorElement = document.createElement("a");
                                bookmarkLink.setAttribute("href", locator.href);

                                if (type == AnnotationType.Bookmark) {
                                    bookmarkLink.className = "bookmark-link"
                                    bookmarkLink.innerHTML = IconLib.bookmark

                                    let title: HTMLSpanElement = document.createElement("span");
                                    let formattedProgression = Math.round(locator.locations.progression!! * 100) + "% " + "through resource"
                                    title.className = "title"
                                    title.innerHTML = formattedProgression;
                                    bookmarkLink.appendChild(title)
                                }

                                let timestamp: HTMLSpanElement = document.createElement("span");
                                timestamp.className = "timestamp"
                                timestamp.innerHTML = self.readableTimestamp(locator.created);
                                bookmarkLink.appendChild(timestamp)

                                addEventListenerOptional(bookmarkLink, 'click', (event: MouseEvent) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    self.handleAnnotationLinkClick(event, locator);
                                });

                                bookmarkItem.appendChild(bookmarkLink);
                                if ((self.delegate.sideNavExanded && self.delegate.material) || !self.delegate.material) {
                                    let bookmarkDeleteLink: HTMLElement = document.createElement("button");
                                    bookmarkDeleteLink.className = "delete";
                                    bookmarkDeleteLink.innerHTML = IconLib.delete;

                                    addEventListenerOptional(bookmarkDeleteLink, 'click', (event: MouseEvent) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        self.handleAnnotationLinkDeleteClick(type, event, locator);
                                    });
                                    bookmarkItem.appendChild(bookmarkDeleteLink);
                                }
                                bookmarkList.appendChild(bookmarkItem);
                            }
                        });

                        if (bookmarkList.children.length > 0) {
                            chapterList.appendChild(chapterHeader);
                            chapterList.appendChild(bookmarkList);
                        }
                        if (chapterList.children.length > 0) {
                            parentElement.appendChild(chapterList);
                        }
                        if (link.children && link.children.length > 0) {
                            createAnnotationTree(parentElement, link.children);
                        }
                    }
                }
                view.innerHTML = '';
                createAnnotationTree(view, toc);
            }
        }
    }

    private handleAnnotationLinkClick(event: MouseEvent, locator: Bookmark): void {
        if (locator) {
            this.delegate.navigate(locator);
        } else {
            if (IS_DEV) { console.log('bookmark data missing: ', event); }
        }
    }

    private handleAnnotationLinkDeleteClick(type: AnnotationType, event: MouseEvent, locator: any): void {
        if (locator) {
            if (type == AnnotationType.Bookmark) {
                this.deleteBookmark(locator);
            }
        } else {
            if (IS_DEV) { console.log('bookmark data missing: ', event); }
        }
    }

    private readableTimestamp(timestamp: string) {
        const date = new Date(timestamp);
        return date.toDateString() + " " + date.toLocaleTimeString()
    }

}