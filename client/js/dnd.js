/*globals qq, document*/
qq.DragAndDrop = function(o) {
    "use strict";

    var options, dz, dirPending,
        droppedFiles = [],
        droppedEntriesCount = 0,
        droppedEntriesParsedCount = 0,
        disposeSupport = new qq.DisposeSupport();

     options = {
        dropZoneElements: [],
        hideDropZonesBeforeEnter: false,
        allowMultipleItems: true,
        classes: {
            dropActive: null
        },
        callbacks: {
            processingDroppedFiles: function() {},
            processingDroppedFilesComplete: function(files) {},
            error: function(code, filename) {
                qq.log(message, "error");
            },
            log: function(message, level) {
                qq.log(message, level);
            }
        }
    };

    qq.extend(options, o);

    function maybeUploadDroppedFiles() {
        if (droppedEntriesCount === droppedEntriesParsedCount && !dirPending) {
            options.callbacks.log('Grabbed ' + droppedFiles.length + " files after tree traversal.");
            dz.dropDisabled(false);
            options.callbacks.processingDroppedFilesComplete(droppedFiles);
        }
    }
    function addDroppedFile(file) {
        droppedFiles.push(file);
        droppedEntriesParsedCount+=1;
        maybeUploadDroppedFiles();
    }

    function traverseFileTree(entry) {
        var dirReader, i;

        droppedEntriesCount+=1;

        if (entry.isFile) {
            entry.file(function(file) {
                addDroppedFile(file);
            });
        }
        else if (entry.isDirectory) {
            dirPending = true;
            dirReader = entry.createReader();
            dirReader.readEntries(function(entries) {
                droppedEntriesParsedCount+=1;
                for (i = 0; i < entries.length; i+=1) {
                    traverseFileTree(entries[i]);
                }

                dirPending = false;

                if (!entries.length) {
                    maybeUploadDroppedFiles();
                }
            });
        }
    }

    function handleDataTransfer(dataTransfer) {
        var i, items, entry;

        options.callbacks.processingDroppedFiles();
        dz.dropDisabled(true);

        if (dataTransfer.files.length > 1 && !options.allowMultipleItems) {
            options.callbacks.processingDroppedFilesComplete([]);
            options.callbacks.error('tooManyFilesError', "");
            dz.dropDisabled(false);
        }
        else {
            droppedFiles = [];
            droppedEntriesCount = 0;
            droppedEntriesParsedCount = 0;

            if (qq.isFolderDropSupported(dataTransfer)) {
                items = dataTransfer.items;

                for (i = 0; i < items.length; i+=1) {
                    entry = items[i].webkitGetAsEntry();
                    if (entry) {
                        //due to a bug in Chrome's File System API impl - #149735
                        if (entry.isFile) {
                            droppedFiles.push(items[i].getAsFile());
                            if (i === items.length-1) {
                                maybeUploadDroppedFiles();
                            }
                        }

                        else {
                            traverseFileTree(entry);
                        }
                    }
                }
            }
            else {
                options.callbacks.processingDroppedFilesComplete(dataTransfer.files);
                dz.dropDisabled(false);
            }
        }
    }

    function setupDropzone(dropArea){
        dz = new qq.UploadDropZone({
            element: dropArea,
            onEnter: function(e){
                qq(dropArea).addClass(options.classes.dropActive);
                e.stopPropagation();
            },
            onLeaveNotDescendants: function(e){
                qq(dropArea).removeClass(options.classes.dropActive);
            },
            onDrop: function(e){
                if (options.hideDropZonesBeforeEnter) {
                    qq(dropArea).hide();
                }
                qq(dropArea).removeClass(options.classes.dropActive);

                handleDataTransfer(e.dataTransfer);
            }
        });

        disposeSupport.addDisposer(function() {
            dz.dispose();
        });

        if (options.hideDropZonesBeforeEnter) {
            qq(dropArea).hide();
        }
    }

    function isFileDrag(dragEvent) {
        var fileDrag;

        qq.each(dragEvent.dataTransfer.types, function(key, val) {
            if (val === 'Files') {
                fileDrag = true;
                return false;
            }
        });

        return fileDrag;
    }

    function setupDragDrop(){
        var dropZones = options.dropZoneElements;

        qq.each(dropZones, function(idx, dropZone) {
           setupDropzone(dropZone);
        })

        // IE <= 9 does not support the File API used for drag+drop uploads
        if (dropZones.length && (!qq.ie() || qq.ie10())) {
            disposeSupport.attach(document, 'dragenter', function(e) {
                if (!dz.dropDisabled() && isFileDrag(e)) {
                    qq.each(dropZones, function(idx, dropZone) {
                        qq(dropZone).css({display: 'block'});
                    });
                }
            });
        }
        disposeSupport.attach(document, 'dragleave', function(e){
            if (options.hideDropZonesBeforeEnter && qq.FineUploader.prototype._leaving_document_out(e)) {
                qq.each(dropZones, function(idx, dropZone) {
                    qq(dropZone).hide();
                });
            }
        });
        disposeSupport.attach(document, 'drop', function(e){
            if (options.hideDropZonesBeforeEnter) {
                qq.each(dropZones, function(idx, dropZone) {
                    qq(dropZone).hide();
                });
            }
            e.preventDefault();
        });
    }

    return {
        init: function() {
            setupDragDrop();
        },

        setupExtraDropzone: function(element) {
            options.dropZoneElements.push(element);
            setupDropzone(element);
        },

        removeExtraDropzone: function(element) {
            var i, dzs = options.additionalDropzoneEls;
            for(i in dzs) {
                if (dzs[i] === element) {
                    return dzs.splice(i, 1);
                }
            }
        },

        dispose: function() {
            disposeSupport.dispose();
            dz.dispose();
        }
    };
};


qq.UploadDropZone = function(o){
    "use strict";

    var options, element, preventDrop, dropOutsideDisabled, disposeSupport = new qq.DisposeSupport();

    options = {
        element: null,
        onEnter: function(e){},
        onLeave: function(e){},
        // is not fired when leaving element by hovering descendants
        onLeaveNotDescendants: function(e){},
        onDrop: function(e){}
    };

    qq.extend(options, o);
    element = options.element;

    function dragover_should_be_canceled(){
        return qq.safari() || (qq.firefox() && qq.windows());
    }

    function disableDropOutside(e){
        // run only once for all instances
        if (!dropOutsideDisabled ){

            // for these cases we need to catch onDrop to reset dropArea
            if (dragover_should_be_canceled){
               disposeSupport.attach(document, 'dragover', function(e){
                    e.preventDefault();
                });
            } else {
                disposeSupport.attach(document, 'dragover', function(e){
                    if (e.dataTransfer){
                        e.dataTransfer.dropEffect = 'none';
                        e.preventDefault();
                    }
                });
            }

            dropOutsideDisabled = true;
        }
    }

    function isValidFileDrag(e){
        // e.dataTransfer currently causing IE errors
        // IE9 does NOT support file API, so drag-and-drop is not possible
        if (qq.ie() && !qq.ie10()) {
            return false;
        }

        var effectTest, dt = e.dataTransfer,
        // do not check dt.types.contains in webkit, because it crashes safari 4
        isSafari = qq.safari();

        // dt.effectAllowed is none in Safari 5
        // dt.types.contains check is for firefox
        effectTest = qq.ie10() ? true : dt.effectAllowed !== 'none';
        return dt && effectTest && (dt.files || (!isSafari && dt.types.contains && dt.types.contains('Files')));
    }

    function isOrSetDropDisabled(isDisabled) {
        if (isDisabled !== undefined) {
            preventDrop = isDisabled;
        }
        return preventDrop;
    }

    function attachEvents(){
        disposeSupport.attach(element, 'dragover', function(e){
            if (!isValidFileDrag(e)) {
                return;
            }

            var effect = qq.ie() ? null : e.dataTransfer.effectAllowed;
            if (effect === 'move' || effect === 'linkMove'){
                e.dataTransfer.dropEffect = 'move'; // for FF (only move allowed)
            } else {
                e.dataTransfer.dropEffect = 'copy'; // for Chrome
            }

            e.stopPropagation();
            e.preventDefault();
        });

        disposeSupport.attach(element, 'dragenter', function(e){
            if (!isOrSetDropDisabled()) {
                if (!isValidFileDrag(e)) {
                    return;
                }
                options.onEnter(e);
            }
        });

        disposeSupport.attach(element, 'dragleave', function(e){
            if (!isValidFileDrag(e)) {
                return;
            }

            options.onLeave(e);

            var relatedTarget = document.elementFromPoint(e.clientX, e.clientY);
            // do not fire when moving a mouse over a descendant
            if (qq(this).contains(relatedTarget)) {
                return;
            }

            options.onLeaveNotDescendants(e);
        });

        disposeSupport.attach(element, 'drop', function(e){
            if (!isOrSetDropDisabled()) {
                if (!isValidFileDrag(e)) {
                    return;
                }

                e.preventDefault();
                options.onDrop(e);
            }
        });
    }

    disableDropOutside();
    attachEvents();

    return {
        dropDisabled: function(isDisabled) {
            return isOrSetDropDisabled(isDisabled);
        },

        dispose: function() {
            disposeSupport.dispose();
        }
    };
};
