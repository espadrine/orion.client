/*******************************************************************************
 * @license
 * Copyright (c) 2010, 2011, 2012 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made 
 * available under the terms of the Eclipse Public License v1.0 
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution 
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html). 
 * 
 * Contributors: IBM Corporation - initial API and implementation
 ******************************************************************************/
/*global define document */

define(['require', 'dojo', 'orion/util', 'orion/commands', 'orion/explorer'],
		function(require, dojo, mUtil, mCommands, mExplorer) {

var mSiteMappingsTable = {};

function mixin(target, source) {
	for (var p in source) {
		if (source.hasOwnProperty(p)) { target[p] = source[p]; }
	}
}

// TODO perhaps site service should be in charge of this.
function isWorkspacePath(/**String*/ path) {
	return new RegExp("^/").test(path);
}

function safePath(str) {
	return str.replace(/[\r\n\t]/g, "");
}

mSiteMappingsTable.Model = (function() {
	function Model(rootPath, fetchItems, items) {
		this.rootPath = rootPath;
		this.fetchItems = fetchItems;
		this.items = items;
	}
	Model.prototype = new mExplorer.ExplorerFlatModel();
	mixin(Model.prototype, {
		getId: function(/**Object*/ item) {
			var result;
			if (item === this.root) {
				result = this.rootId;
			} else {
				result = "mapping_" + this.items.indexOf(item);
			}
			return result;
		}});
	return Model;
}());

/**
 * @param {Function} options.onchange Callback with signature: <code>function(item, fieldName, newValue, event)</code>
 */
mSiteMappingsTable.Renderer = (function() {
	function Renderer(options, explorer) {
		this._init(options);
		this.options = options;
		this.explorer = explorer;
	}
	Renderer.prototype = new mExplorer.SelectionRenderer();
	mixin(Renderer.prototype, {
		getCellHeaderElement: function(/**Number*/ col_no) {
			var col;
			switch(col_no){
				case 0:
					col = dojo.create("th", {innerHTML: " "});
					dojo.addClass(col, "isValidColumn");
					return col;
				case 1: return dojo.create("th", {innerHTML: "Path"});
				case 2: return dojo.create("th", {innerHTML: "Mount at (server path)"});
				case 3: return dojo.create("th", {innerHTML: "Actions"});
			}
		},
		getCellElement: function(/**Number*/ col_no, /**Object*/ item, /**HTMLTableRowElement*/ tableRow) {
			var col, input, handler;
			switch(col_no) {
				case 0:
					return this.getIsValidCell(col_no, item, tableRow);
				case 1: // Path
					col = dojo.create("td");
					input = dojo.create("input");
					dojo.addClass(input, "pathInput");
					// TODO
					input.value = typeof item.FriendlyPath !== "undefined" ? item.FriendlyPath : item.Target;
					handler = dojo.hitch(this, function(event) {
							this.options.onchange(item, "FriendlyPath", event.target.value, event);
						});
					input.onchange = handler;
					input.onkeyup = handler;
					dojo.place(input, col);
					return col;
				case 2: // Mount at
					col = dojo.create("td");
					input = dojo.create("input");
					dojo.addClass(input, "serverPathInput");
					input.value = item.Source;
					handler =  dojo.hitch(this, function(event) {
							this.options.onchange(item, "Source", event.target.value, event);
						});
					input.onchange = handler;
					input.onkeyup = handler;
					dojo.place(input, col);
					return col;
				case 3: // Actions
					return this.getActionsColumn(item, tableRow);
			}
		},
		getIsValidCell: function(/**Number*/ col_no, /**Object*/ item, /**HTMLTableRowElement*/ tableRow) {
			var target = item.Target;
			var col = document.createElement("td");
			var href;
			if (isWorkspacePath(target)) {
				var self = this;
				this.options.siteClient.toFileLocation(target).then(function(loc) {
					href = mUtil.safeText(loc);
					col.innerHTML = "<span class=\"validating\">&#8230;</span>";
					// use file service directly to avoid retrying in case of failure
					self.options.fileClient._getService(loc).read(loc, true).then(
						function(object) {
							var isDirectory = object && object.Directory;
							var spriteClass = isDirectory ? "core-sprite-folder" : "core-sprite-file";
							var title = (isDirectory ? "Workspace folder" : "Workspace file") + " " + href;
							col.innerHTML = '<a href="' + href + '" target="_new"><span class="imageSprite ' + spriteClass + '" title="' + title + '"/></a>';
						}, function(error) {
							col.innerHTML = '<a href="' + href + '" target="_new"><span class="imageSprite core-sprite-error" title="Workspace resource not found: ' + href + '"/></a>';
						});
				});
			} else {
				href = mUtil.safeText(target);
				col.innerHTML = '<a href="' + href + '" target="_new"><span class="imageSprite core-sprite-link" title="External link to ' + href + '"/></a>';
			}
			dojo.addClass(col, "isValidCell");
			return col;
		}
	});
	return Renderer;
}());

/**
 * @name orion.sites.MappingsTable
 */
mSiteMappingsTable.MappingsTable = (function() {
	function MappingsTable(options) {
		this.registry = options.serviceRegistry;
		this.commandService = this.registry.getService("orion.page.command");
		this.registerCommands();
		this.siteClient = options.siteClient;
		this.parentId = options.parentId;
		this.selection = options.selection;
		this.renderer = new mSiteMappingsTable.Renderer({
				checkbox: false, /*TODO make true when we have selection-based commands*/
				onchange: dojo.hitch(this, this.fieldChanged),
				siteConfiguration: options.siteConfiguration,
				siteClient: options.siteClient,
				fileClient: options.fileClient,
				actionScopeId: "siteMappingCommand"
			}, this);
		this.myTree = null;
		this._setSiteConfiguration(options.siteConfiguration);
		this.setDirty(false);
	}
	MappingsTable.prototype = new mExplorer.Explorer();
	mixin(MappingsTable.prototype, /** @lends orion.sites.MappingsTable.prototype */ {
		_setSiteConfiguration: function(site) {
			this.siteConfiguration = site;
			this.refresh();
		},
		refresh: function() {
			var fetchItems = dojo.hitch(this, function() {
				var d = new dojo.Deferred();
				d.callback(this.siteConfiguration.Mappings);
				return d;
			});
			// Refresh display names from the site service
			var self = this;
			this.siteClient.updateMappingsDisplayStrings(this.siteConfiguration).then(function(updatedSite) {
				self.siteConfiguration.Mappings = updatedSite.Mappings;
				// Build visuals
				self.createTree(self.parentId, new mSiteMappingsTable.Model(null, fetchItems, self.siteConfiguration.Mappings));
			});
		},
		render: function() {
			this.changedItem(this.siteConfiguration.Mappings, this.siteConfiguration.Mappings);
		},
		// Render the row of a single item, without rendering its siblings.
		renderItemRow: function(item, fieldName) {
			if (fieldName === "FriendlyPath") {
				// Just update the "is valid" column
				var rowNode = dojo.byId(this.myTree._treeModel.getId(item));
				var oldCell = dojo.query(".isValidCell", rowNode)[0];
				var col_no = dojo.query("td", rowNode).indexOf(oldCell);
				var cell = this.renderer.getIsValidCell(col_no, item, rowNode);
				dojo.place(cell, oldCell, "replace");
			}
		},
		registerCommands: function() {
			var deleteMappingCommand = new mCommands.Command({
				name: "Delete",
				imageClass: "core-sprite-delete",
				id: "orion.site.mappings.remove",
				visibleWhen: function(item) {
					// Only show on a Mappings object
					return typeof item.Source !== "undefined" && typeof item.Target !== "undefined";
				},
				callback: dojo.hitch(this, function(data) {
					//table._hideTooltip();
					this.deleteMapping(data.items);
					this.render();
					this.setDirty(true);
				})});
			this.commandService.addCommand(deleteMappingCommand);
			this.commandService.registerCommandContribution("siteMappingCommand", "orion.site.mappings.remove", 0);
			
			var moveUpCommand = new mCommands.Command({
				name: "Move Up",
				imageClass: "core-sprite-move_up",
				id: "orion.site.mappings.moveUp",
				visibleWhen: dojo.hitch(this, function(item) {
					return item.Source && item.Target;
				}),
				callback: dojo.hitch(this, function(data) {
					var index = this.getItemIndex(data.items);
					if (index === 0) { return; }
					var temp = this.siteConfiguration.Mappings[index-1];
					this.siteConfiguration.Mappings[index-1] = data.items;
					this.siteConfiguration.Mappings[index] = temp;
					this.render();
					this.setDirty(true);
				})});
			this.commandService.addCommand(moveUpCommand);
			this.commandService.registerCommandContribution("siteMappingCommand", "orion.site.mappings.moveUp", 1);
			
			var moveDownCommand = new mCommands.Command({
				name: "Move Down",
				imageClass: "core-sprite-move_down",
				id: "orion.site.mappings.moveDown",
				visibleWhen: dojo.hitch(this, function(item) {
					return item.Source && item.Target;
				}),
				callback: dojo.hitch(this, function(data) {
//					this._hideTooltip();
					var index = this.getItemIndex(data.items);
					if (index === this.siteConfiguration.Mappings.length - 1) { return; }
					var temp = this.siteConfiguration.Mappings[index+1];
					this.siteConfiguration.Mappings[index+1] = data.items;
					this.siteConfiguration.Mappings[index] = temp;
					this.render();
					this.setDirty(true);
				})});
			this.commandService.addCommand(moveDownCommand);
			this.commandService.registerCommandContribution("siteMappingCommand", "orion.site.mappings.moveDown", 2);
		},
		getItemIndex: function(item) {
			return this.siteConfiguration.Mappings.indexOf(item);
		},
		_addMapping: function(object) {
			var source = object.Souce, target = object.Target, friendlyPath = object.FriendlyPath;
			source = safePath(typeof(source) === "string" ? source : this.getNextMountPoint(friendlyPath));
			target = safePath(typeof(target) === "string" ? target : "/");
			if (!this.mappingExists(source, target)) {
				this.siteConfiguration.Mappings.push(object);
			}
		},
		addMapping: function(object) {
			this._addMapping(object);
			this.render();
			this.setDirty(true);
		},
		addMappings: function(mappings) {
			for (var i=0; i < mappings.length; i++) {
				this.addMapping(mappings[i]);
			}
			this.render();
			this.setDirty(true);
		},
		mappingExists: function(source, target) {
			if (typeof source === "object" && typeof target === "undefined") {
				target = source.Target;
				source = source.Source;
			}
			var mappings = this.siteConfiguration.Mappings;
			for (var i=0; i < mappings.length; i++) {
				if (mappings[i].Source === source && mappings[i].Target === target) {
					return true;
				}
			}
			return false;
		},
		getNextMountPoint: function(/**String*/ friendlyPath) {
			// Try root first
			var mappings = this.siteConfiguration.Mappings;
			var hasRoot = false;
			for (var i=0; i < mappings.length; i++) {
				if (mappings[i].Source === "/") {
					hasRoot = true;
					break;
				}
			}
			if (!hasRoot) {
				return "/";
			}
			// Else base it on friendlyPath
			if (!friendlyPath) {
				return "/web/somePath";
			}
			var segments = friendlyPath.split("/");
			for (i = segments.length-1; i >= 0; i--) {
				if (!/\s+/.test(segments[i])) {
					return "/" + segments[i];
				}
			}
			return "/web/somePath";
		},
		deleteMapping: function(/**Object*/ mapping) {
			var index = this.siteConfiguration.Mappings.indexOf(mapping);
			if (index !== -1) {
				this.siteConfiguration.Mappings.splice(index, 1);
			}
		},
		deleteAllMappings: function() {
			this.siteConfiguration.Mappings.splice(0, this.siteConfiguration.Mappings.length);
		},
		fieldChanged: function(/**Object*/ item, /**String*/ fieldName, /**String*/ newValue, /**Event*/ event) {
			newValue = safePath(newValue);
			var oldValue = item[fieldName];
			if (oldValue !== newValue) {
				item[fieldName] = newValue;
				if (fieldName === "FriendlyPath") {
					// Convert displayed string into the internal path representation, update the Target field
					var friendlyPath = newValue;
					var self = this;
					this.siteClient.parseInternalForm(this.siteConfiguration, friendlyPath).then(
						function(internalPath) {
							item.Target = internalPath || friendlyPath;
							self.renderItemRow(item, fieldName);
							self.setDirty(true);	
						});
				}
			}
		},
		setDirty: function(value) {
			this._isDirty = value;
		},
		isDirty: function() {
			return this._isDirty;
		}
	});
	return MappingsTable;
}());

return mSiteMappingsTable;
});