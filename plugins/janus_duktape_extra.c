/*! \file   janus_duktape_extra.c
 * \author Lorenzo Miniero <lorenzo@meetecho.com>
 * \copyright GNU General Public License v3
 * \brief  Janus Duktape plugin extra hooks
 * \details  The Janus Duktape plugin implements all the mandatory hooks to
 * allow the C code to interact with a custom JavaScript script, and viceversa.
 * Anyway, JavaScript developers may want to have the C code do more than what
 * is provided out of the box, e.g., by exposing additional JavaScript methods
 * from C for further low level processing or native integration. This
 * "extra" implementation provides a mechanism to do just that, as
 * developers can just add their own custom hooks in the C extra code,
 * and the Duktape plugin will register the new methods along the stock ones.
 *
 * More specifically, the Janus Duktape plugin will always invoke the
 * janus_duktape_register_extra_functions() method when initializing. This
 * means that all developers will need to do to register a new function
 * is adding new \c duk_push_c_function calls to register their own functions
 * there, and they'll be added to the stack.
 *
 * \ingroup jspapi
 * \ref jspapi
 */

#include "janus_duktape_data.h"
#include "janus_duktape_extra.h"

/* Helper method to stringify Duktape types */
#define DUK_CASE_STR(type) case type: return #type
static const char *janus_duktape_type_string(int type) {
    switch(type) {
        DUK_CASE_STR(DUK_TYPE_NONE);
        DUK_CASE_STR(DUK_TYPE_UNDEFINED);
        DUK_CASE_STR(DUK_TYPE_NULL);
        DUK_CASE_STR(DUK_TYPE_BOOLEAN);
        DUK_CASE_STR(DUK_TYPE_NUMBER);
        DUK_CASE_STR(DUK_TYPE_STRING);
        DUK_CASE_STR(DUK_TYPE_OBJECT);
        DUK_CASE_STR(DUK_TYPE_BUFFER);
        DUK_CASE_STR(DUK_TYPE_POINTER);
        DUK_CASE_STR(DUK_TYPE_LIGHTFUNC);
        default:
            break;
    }
    return NULL;
}

/* Sample extra function we can register */
static duk_ret_t janus_duktape_extra_sample(duk_context *ctx) {
	/* Let's do nothing, and return 1234 */
	duk_push_int(ctx, 1234);
	return 1;
}

/* This is where you can add your custom extra functions */


static duk_ret_t janus_duktape_method_filesize(duk_context *ctx) {

    /* Helper method to get file size */
    if(duk_get_type(ctx, 0) != DUK_TYPE_STRING) {
        duk_push_error_object(ctx, DUK_RET_TYPE_ERROR, "Invalid argument (expected %s, got %s)\n",
            janus_duktape_type_string(DUK_TYPE_STRING), janus_duktape_type_string(duk_get_type(ctx, 0)));
        return duk_throw(ctx);
    }

    const char *filename = duk_get_string(ctx, 0);

    FILE *f = fopen(filename, "rb");
    if(f == NULL) {
        duk_push_error_object(ctx, DUK_ERR_ERROR, "Error opening file: %s\n", filename);
        return duk_throw(ctx);
    }

    fseek(f, 0, SEEK_END);
    size_t fileSize = (size_t)ftell(f);
    fclose(f);

    duk_push_int(ctx, fileSize);
    return 1;
}

static duk_ret_t janus_duktape_method_readfilechunk(duk_context *ctx) {

    /* Helper method to read chunk of a text file and return its content as a string */
    if(duk_get_type(ctx, 0) != DUK_TYPE_STRING) {
        duk_push_error_object(ctx, DUK_RET_TYPE_ERROR, "Invalid argument (expected %s, got %s)\n",
            janus_duktape_type_string(DUK_TYPE_STRING), janus_duktape_type_string(duk_get_type(ctx, 0)));
        return duk_throw(ctx);
    }

    if(duk_get_type(ctx, 1) != DUK_TYPE_NUMBER) {
        duk_push_error_object(ctx, DUK_RET_TYPE_ERROR, "Invalid argument (expected %s, got %s)\n",
            janus_duktape_type_string(DUK_TYPE_NUMBER), janus_duktape_type_string(duk_get_type(ctx, 1)));
        return duk_throw(ctx);
    }

    if(duk_get_type(ctx, 2) != DUK_TYPE_NUMBER) {
        duk_push_error_object(ctx, DUK_RET_TYPE_ERROR, "Invalid argument (expected %s, got %s)\n",
            janus_duktape_type_string(DUK_TYPE_NUMBER), janus_duktape_type_string(duk_get_type(ctx, 2)));
        return duk_throw(ctx);
    }

    const char *filename = duk_get_string(ctx, 0);

    size_t offset = (size_t)duk_get_number(ctx, 1);
    int len = (int)duk_get_number(ctx, 2);

    FILE *f = fopen(filename, "rb");
    if(f == NULL) {
        duk_push_error_object(ctx, DUK_ERR_ERROR, "Error opening file: %s\n", filename);
        return duk_throw(ctx);
    }

    fseek(f, 0, SEEK_END);
    size_t fileSize = (size_t)ftell(f);

    int _fileSize = fileSize * 1;
    int _offset = offset * 1;

    if (offset >= fileSize) {
        duk_push_int(ctx, -1);
        fclose(f);
        return 1;
    }

    long long int leftToRead = fileSize - (offset + len);

    if (leftToRead == 0) {
        duk_push_int(ctx, -1);
        fclose(f);
        return 1;
    }

    if (leftToRead < 0) {
        len+= leftToRead;
    }
    
    fseek(f, offset, SEEK_SET);
    char *text = g_malloc(len);
    size_t r = fread(text, 1, len, f);
    if(r == 0) {
        fclose(f);
        g_free(text);
        duk_push_error_object(ctx, DUK_ERR_ERROR, "Error reading file: %s\n", filename);
        return duk_throw(ctx);
    }

    duk_push_lstring(ctx, text, len);
    fclose(f);
    g_free(text);
    return 1;
}


/* Public method to register all custom extra functions */
void janus_duktape_register_extra_functions(duk_context *ctx) {
	if(ctx == NULL)
		return;
	JANUS_LOG(LOG_VERB, "Registering extra Duktape functions\n");
	/* Register all extra functions here */
	duk_push_c_function(ctx, janus_duktape_extra_sample, 0);
	duk_put_global_string(ctx, "testExtraFunction");

    duk_push_c_function(ctx, janus_duktape_method_readfilechunk, 3);
    duk_put_global_string(ctx, "readFileChunk");

    duk_push_c_function(ctx, janus_duktape_method_filesize, 1);
    duk_put_global_string(ctx, "fileSize");
}
