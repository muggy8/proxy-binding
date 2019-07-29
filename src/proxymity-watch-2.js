function hasProp(obj, prop){
	return Object.prototype.hasOwnProperty.call(obj, prop)
}

function watch(source, path, onchange, ondelete = function(){}){
	var context = this || {}
	var pathsToEval = splitPath(path)
	var pathsStrings = []
	forEach(pathsToEval, function(pathString){
		pathsStrings.push(safeEval.call(context, pathString))
	})


	// now we have the path from the source to the target prop figured out. all we have to do now is to follow the path and replace any non-internal descriptors with internal descriptor and if it doesn't exist, initialize it as {}. once we get to the final descriptor we can add the watch props onto it and just wait for it to change

	var propertyDescriptor // the thing we try to find and attach our listeners to
	var location = "" // for debugging
	forEach(pathsStrings, function(key){
		if (key === "length" && isArray(source)){
			key = "len"
		}
		if (key === "len"){
			overrideArrayFunctions(source)
		}
		location = location + (location ? " -> " + key : key)

		try{
			var descriptor = Object.getOwnPropertyDescriptor(source, key)
		}
		catch(uwu){
			console.log(location, source, path, pathsStrings)
			throw uwu
		}

		// if the property doesn't exist we can create it here
		if (typeof descriptor === "undefined"){
			console.warn(location + " not defined in data source and is initiated as {}. \n\tOriginal: " + path)
			propertyDescriptor = createWatchableProp(source, key)
		}

		// our non-standard descriptors are the special since they are also ment to be accessed via this method and we can pass in parameters that are normally not
		else if (isInternalDescriptor(descriptor)){
			propertyDescriptor = descriptor
		}

		// the final case is that it exists already and we need to transfer it to a getter and a setter
		else if (descriptor){
			var value = source[key]
			delete source[key]
			propertyDescriptor = createWatchableProp(source, key, value)
		}

		source = source[key]

	})

	return propertyDescriptor.get(safeOnchange, safeOndelete)

	function safeOnchange(){
		var args = Array.prototype.slice.call(arguments)
		return onchange.apply(context, args)
	}
	function safeOndelete(){
		var args = Array.prototype.slice.call(arguments)
		return ondelete.apply(context, args)
	}
}

function isInternalDescriptor(descriptor){
	return descriptor && descriptor.get && descriptor.get.length === 2 && descriptor.set && descriptor.set.length === 1
}

function createWatchableProp(obj, prop, value = {}, config = {}){
	var callbackSet = new LinkedList()
	var descriptor
	overrideArrayFunctions(value)

	// the scope of this function is where the value of the properties are stored. in here we can also watch for state changes via the getters and setters allowing us to update the view when the view updates as we can detect it with this pair of getters and setters.
	Object.defineProperty(obj, prop, descriptor = {
		enumerable: hasProp(config, "enumerable") ? config.enumerable : true,
		configurable: hasProp(config, "configurable") ? config.configurable : true,
		get: function(onChangeCallack, onDeleteCallback){
			// the getter function serves double duty. since the getter function is declared here, it has access to the scope of the parent function and also leaves no major residue or attack surface for people to get into the internals of this library, it's unlikely that someone is able to gain access to many of the secrets of the internals of the library at run time through this function. However because this function can be called normally outside of just using assignments, we are able to have this function serve double duty as the entry point to add callbacks to the watch method as well as being the getter under normal query and assignment operations.

			if (onChangeCallack && onDeleteCallback){
				console.log("add cb on", obj, prop)
				var link = callbackSet.find(function(item){
					return item.set === onChangeCallack && item.del === onDeleteCallback
				})

				!link && (link = callbackSet.push({
					set: onChangeCallack,
					del: onDeleteCallback
				}))

				onChangeCallack(value, null)

				return link.drop
			}
			return value
		},
		set: function(newValue){
			if (typeof newValue === "undefined"){
				console.log("del", obj, prop)
				// attempting to delete this prop we should call the del callback of all watchers attached to this item
				delete obj[prop]

				callbackSet.each(function(set){
					set.del()
					set.drop()
				})

				deleteChildrenRecursive(value)
			}
			else{
				// updated the stuff lets call all the set callbacks
				if (newValue !== value){
					console.log("set", obj, prop)
					callbackSet.each(function(chainLink){
						onNextEventCycle(chainLink.set, newValue, value)
					})

					var oldVal = value
					overrideArrayFunctions(value = newValue)
					deleteChildrenRecursive(oldVal)
				}
				return value
			}
		}
	})

	return descriptor
}

function deleteChildrenRecursive(value){
	if (isObject(value)){
		if (isArray(value) && hasProp(value, "len")){
			value.len = undefined
		}
		console.log("deleteChildrenRecursive", value, Object.keys(value))
		forEach(Object.keys(value), function(name){
			var descriptor = Object.getOwnPropertyDescriptor(value, name)
			console.log("deleting", name, isInternalDescriptor(descriptor))
			if (isInternalDescriptor(descriptor)){
				value[name] = undefined
			}
		})
	}
}

var replacementFunctions = {}
forEach(Object.getOwnPropertyNames(Array.prototype), function(prop){
	var wrappedFunction = Array.prototype[prop]
	if (typeof wrappedFunction !== "function"){
		return
	}
	replacementFunctions[prop] = function(){
		var args = Array.prototype.slice.call(arguments)
		var res = wrappedFunction.apply(this, args)
		this.len = this.length
		return res
	}
})
function overrideArrayFunctions(arr){
	if (!arr || !isArray(arr) || hasProp(arr, 'len')){
		return
	}
	createWatchableProp(arr, "len", arr.length, {enumerable: false})
	forEach(Object.getOwnPropertyNames(replacementFunctions), function(prop){
		var fn = replacementFunctions[prop]
		define(arr, prop, fn)
	})
}


function LinkedList(){
	var context = this
	context.first = null
	context.last = null
	context.length = 0
}
LinkedList.prototype = {
	push: function(payload){
		var context = this
		var item = new LinkedItem(payload, context)
		item.prev = context.last
		context.last && (context.last.next = item)
		context.last = item
		!context.first && (context.first = item)
		context.length++
		return item
	},
	each: function(callback){
		var current = this.first
		while(current){
			callback(current)
			current = current.next
		}
	},
	find: function(callback){
		var current = this.first
		var index = 0
		var found = null
		while(current && !found){
			var hasFound = callback(current, index)
			index++
			hasFound && (found = current)
			current = current.next
		}
		return found
	}
}

function LinkedItem(payload, belongsTo){
	var context = this
	Object.assign(context, payload)
	context.prev = null
	context.next = null
	context.drop = function(){
		dropLinkedItem(context, belongsTo)
	}
}
function dropLinkedItem(item, belongsTo){
	var hasChanged = false
	item.prev && item.prev.next === item && ((item.prev.next = item.next) + (hasChanged = true))
	item.next && item.next.prev === item && ((item.next.prev = item.prev) + (hasChanged = true))

	if (!hasChanged){
		return
	}
	belongsTo.first === item && (belongsTo.first = item.next)
	belongsTo.last === item && (belongsTo.last = item.prev)
	belongsTo.length--

}
